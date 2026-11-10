import React, { Suspense } from 'react';
import { useT } from '../i18n/LanguageContext';
import { lazyShellPart } from '../lib/routeRecovery';
import { ShellPartBoundary } from './ShellPartBoundary';

// react-syntax-highlighter's `prism` build bundles every language grammar (and
// every theme), which is ~640 KB raw. The `prism-light` build ships an empty
// registry that we populate with only the languages this app actually renders.
// Saves ~180 KB gzip off the lazy code-block chunk.
const SUPPORTED_LANGUAGES = ['javascript', 'typescript', 'jsx', 'tsx', 'css', 'markup', 'bash', 'json'] as const;

// The highlighter's code, asked for once: by the first code block, or ahead of
// it when the learner reaches for a step whose questions carry code
// (`preloadCodeHighlighter`). A load that failed is asked for again next time.
let highlighter: ReturnType<typeof importHighlighter> | null = null;
function loadHighlighter(): ReturnType<typeof importHighlighter> {
  highlighter ??= importHighlighter().catch((error: unknown) => {
    highlighter = null;
    throw error;
  });
  return highlighter;
}

/** Start loading the code highlighter (prism-light, its grammars and theme)
 * without waiting for it: the Learn map calls it when a mouse rests on, or
 * the focus reaches, a step of a topic whose questions carry code, as it does
 * for the level runner's chunk (perf baseline #587 C28). The first code block
 * then draws highlighted without its own wait. */
export function preloadCodeHighlighter(): void {
  loadHighlighter().catch(() => {});
}

// A `lazyShellPart` with a boundary of its own: when the highlighter's code does
// not load, the block stays plain text, which already reads in full, and the
// page around it stays. No Retry button: the next code block asks again.
const Highlighter = lazyShellPart(loadHighlighter);

async function importHighlighter() {
  const [
    PrismLightMod,
    styleMod,
    js, ts, jsx, tsx, css, markup, bash, json,
  ] = await Promise.all([
    import('react-syntax-highlighter/dist/esm/prism-light'),
    import('react-syntax-highlighter/dist/esm/styles/prism/one-dark'),
    import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
    import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
    import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
    import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
    import('react-syntax-highlighter/dist/esm/languages/prism/css'),
    import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
    import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
    import('react-syntax-highlighter/dist/esm/languages/prism/json'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PrismLight = (PrismLightMod as any).default as React.ComponentType<any> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLanguage: (name: string, syntax: any) => void;
  };
  const grammars: Record<string, unknown> = {
    javascript: (js as { default: unknown }).default,
    typescript: (ts as { default: unknown }).default,
    jsx: (jsx as { default: unknown }).default,
    tsx: (tsx as { default: unknown }).default,
    css: (css as { default: unknown }).default,
    markup: (markup as { default: unknown }).default,
    bash: (bash as { default: unknown }).default,
    json: (json as { default: unknown }).default,
  };
  for (const lang of SUPPORTED_LANGUAGES) {
    PrismLight.registerLanguage(lang, grammars[lang]);
  }
  const oneDark = (styleMod as { default: unknown }).default;
  return {
    default: function HighlightedCode({ language, code }: { language: string; code: string }) {
      return (
        <PrismLight
          language={language}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style={oneDark as any}
          PreTag={CodeBox}
          codeTagProps={{ style: CODE_STYLE }}
        >
          {code}
        </PrismLight>
      );
    },
  };
}

// The block's box: one-dark's `pre` rule with the app's size, spacing and
// font. Plain and highlighted, the code sits in this same <pre>, so the
// highlighter's arrival only colours the tokens: the element, its height, its
// font and a learner's horizontal scroll stay. It used to swap the plain <pre>
// for its own, a few hundred milliseconds after the block was drawn (React
// holds a Suspense reveal 300 ms after the fallback), with another font and
// line height.
const PRE_STYLE: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  margin: '1rem 0',
  padding: 'var(--ss-code-padding, 1rem)',
  borderRadius: 6,
  fontSize: 'var(--ss-code-size, 0.75rem)',
  lineHeight: 1.5,
  background: 'hsl(220, 13%, 18%)',
  color: 'hsl(220, 14%, 71%)',
  textShadow: '0 1px rgba(0, 0, 0, 0.3)',
  direction: 'ltr',
  textAlign: 'left',
  whiteSpace: 'pre',
  wordSpacing: 'normal',
  wordBreak: 'normal',
  tabSize: 2,
  hyphens: 'none',
  overflow: 'auto',
  fontFamily: '"SF Mono", Consolas, Monaco, monospace',
};
const CODE_STYLE: React.CSSProperties = { whiteSpace: 'pre', fontFamily: PRE_STYLE.fontFamily };

/** The highlighter draws its tokens into CodeBlock's own <pre>: its `pre`
 * stands aside and passes its children through. */
function CodeBox({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

const PlainCode = ({ code }: { code: string }) => <code style={CODE_STYLE}>{code}</code>;

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const t = useT();
  return (
    <pre aria-label={t('a11y.codeBlock', { language })} style={PRE_STYLE}>
      <Suspense fallback={<PlainCode code={code} />}>
        <ShellPartBoundary fallback={() => <PlainCode code={code} />}>
          <Highlighter code={code} language={language} />
        </ShellPartBoundary>
      </Suspense>
    </pre>
  );
}

// Inline code style — a soft chip that reads as code without the visual noise
// of raw backticks. Kept subtle so a stem stays legible even when it names
// several APIs.
const INLINE_CODE_STYLE: React.CSSProperties = {
  fontFamily: '"SF Mono", Consolas, Monaco, monospace',
  fontSize: '0.92em',
  padding: '0.1em 0.35em',
  borderRadius: 4,
  backgroundColor: 'rgba(127, 127, 127, 0.14)',
  border: '1px solid rgba(127, 127, 127, 0.18)',
};

/** Render a plain-text run with `single backticks` swapped for inline chips. */
function renderInline(text: string, keyBase: string) {
  const bits = text.split(/(`[^`]+`)/g);
  return bits.map((bit, i) => {
    if (bit.startsWith('`') && bit.endsWith('`') && bit.length >= 2) {
      return (
        <code key={`${keyBase}-${i}`} style={INLINE_CODE_STYLE}>
          {bit.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyBase}-${i}`}>{bit}</span>;
  });
}

export function renderQuestion(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const langMatch = part.match(/```(\w*)\n?/);
      const raw = langMatch?.[1] || 'javascript';
      // Normalize the language names that aren't direct Prism grammars.
      const language =
        raw === 'js' ? 'javascript'
          : raw === 'ts' ? 'typescript'
          : raw === 'html' ? 'markup'
          : raw === 'shell' || raw === 'sh' ? 'bash'
          : raw || 'javascript';
      const code = part.replace(/```\w*\n?/, '').replace(/```$/, '').trim();
      return <CodeBlock key={index} code={code} language={language} />;
    }
    return <span key={index}>{renderInline(part, String(index))}</span>;
  });
}
