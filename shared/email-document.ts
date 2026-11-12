/**
 * The body of an editable email, as the administration's rich-text editor
 * writes it (Tiptap JSON). Ported from the NAVIGYM administration (owner,
 * 12 November 2026). Only these node types exist: paragraphs, three heading
 * levels, bullet and numbered lists, line breaks, and bold, italic and
 * underline. No HTML, styles, links or images are accepted, so the renderer
 * below, not anything an editor pasted, decides the markup that is sent.
 */
export type EmailMark = { type: 'bold' | 'italic' | 'underline' };
export type EmailInline = { type: 'text'; text: string; marks?: EmailMark[] } | { type: 'hardBreak' };
export type EmailBlock =
  | { type: 'paragraph'; content?: EmailInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: EmailInline[] }
  | { type: 'bulletList'; content: EmailListItem[] }
  | { type: 'orderedList'; attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null }; content: EmailListItem[] };
export interface EmailListItem {
  type: 'listItem';
  content: EmailBlock[];
}
export interface EmailDocument {
  type: 'doc';
  content: EmailBlock[];
}

const MAX_NODES = 1000;
const MAX_CHARACTERS = 8000;
const MAX_DEPTH = 12;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

/** A bounded, explicit check of the editor's JSON. Anything else is refused whole. */
export function isEmailDocument(value: unknown): value is EmailDocument {
  let nodes = 0;
  let characters = 0;
  function node(value: unknown, allowed: string[], depth: number): boolean {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES || !object(value) || !allowed.includes(String(value.type))) return false;
    const type = value.type;
    if (type === 'text') {
      if (!only(value, ['type', 'text', 'marks']) || typeof value.text !== 'string' || !value.text.length) return false;
      characters += value.text.length;
      if (characters > MAX_CHARACTERS) return false;
      if (value.marks === undefined) return true;
      return Array.isArray(value.marks) && value.marks.length <= 3
        && new Set(value.marks.map(mark => object(mark) && mark.type)).size === value.marks.length
        && value.marks.every(mark => object(mark) && only(mark, ['type']) && ['bold', 'italic', 'underline'].includes(String(mark.type)));
    }
    if (type === 'hardBreak') return only(value, ['type']);
    if (!only(value, ['type', 'content', ...(type === 'heading' || type === 'orderedList' ? ['attrs'] : [])])) return false;
    if (type === 'heading' && (!object(value.attrs) || !only(value.attrs, ['level'])
      || typeof value.attrs.level !== 'number' || ![1, 2, 3].includes(value.attrs.level))) return false;
    if (type === 'orderedList' && value.attrs !== undefined) {
      if (!object(value.attrs) || !only(value.attrs, ['start', 'type'])) return false;
      const start = value.attrs.start;
      if (start !== undefined && (!Number.isInteger(start) || Number(start) < 1 || Number(start) > 10000)) return false;
      if (value.attrs.type != null && !['1', 'a', 'A', 'i', 'I'].includes(String(value.attrs.type))) return false;
    }
    const content = value.content ?? [];
    if (!Array.isArray(content) || content.length > MAX_NODES) return false;
    if (type === 'paragraph' || type === 'heading') return content.every(child => node(child, ['text', 'hardBreak'], depth + 1));
    if (type === 'listItem') {
      return content.length > 0 && object(content[0]) && content[0].type === 'paragraph'
        && content.every((child, index) => node(child, index === 0 ? ['paragraph'] : ['paragraph', 'bulletList', 'orderedList'], depth + 1));
    }
    if (type === 'bulletList' || type === 'orderedList') return content.length > 0 && content.every(child => node(child, ['listItem'], depth + 1));
    return type === 'doc' && content.length > 0
      && content.every(child => node(child, ['paragraph', 'heading', 'bulletList', 'orderedList'], depth + 1));
  }
  return node(value, ['doc'], 0);
}

const VARIABLE = /\{([a-z_]+)\}/g;
const has = (variables: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(variables, key);

/** Literal replacement: a value is never parsed again as formatting or HTML. */
export function replaceEmailVariables(value: string, variables: Record<string, string>): string {
  return value.replace(VARIABLE, (token, key: string) => (has(variables, key) ? variables[key]! : token));
}

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const inlineText = (content: EmailInline[] = []) => content.map(n => (n.type === 'hardBreak' ? '\n' : n.text)).join('');

/** The plain-text part of an email: paragraphs split by a blank line, lists with • or 1. */
export function emailDocumentToText(document: EmailDocument, variables: Record<string, string> = {}): string {
  function blocks(content: EmailBlock[], depth = 0): string {
    return content.map(block => {
      if (block.type === 'paragraph' || block.type === 'heading') return replaceEmailVariables(inlineText(block.content), variables);
      return block.content.map((item, index) => {
        const prefix = block.type === 'orderedList' ? `${(block.attrs?.start ?? 1) + index}.` : '•';
        return `${'  '.repeat(depth)}${prefix} ${blocks(item.content, depth + 1)}`;
      }).join('\n');
    }).join('\n\n');
  }
  // A variable that resolves to nothing must not leave a stray empty paragraph.
  return blocks(document.content).replace(/[^\S\n]*\n(?:[^\S\n]*\n)+/g, '\n\n').trim();
}

/** A document from plain text: blank lines split paragraphs, single newlines are line breaks. */
export function textEmailDocument(body: string): EmailDocument {
  return {
    type: 'doc',
    content: body.split(/\n{2,}/).map(paragraph => {
      const content: EmailInline[] = [];
      paragraph.split('\n').forEach((line, index) => {
        if (index) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content };
    }),
  };
}

/** Every variable a document uses, such as `{link}`. */
export function emailDocumentVariables(document: EmailDocument): string[] {
  return [...new Set([...emailDocumentToText(document).matchAll(VARIABLE)].map(match => match[0]))];
}

/** Only validated node types, each with fixed inline styles every mail client honours. */
export function emailDocumentHtml(document: EmailDocument, variables: Record<string, string>, style: { font: string; color: string }): string {
  const base = `font-family:${style.font};color:${style.color};`;
  function styled(value: string, marks: EmailMark[]): string {
    let text = escapeEmailHtml(value).replace(/\n/g, '<br />');
    for (const mark of marks) {
      if (mark.type === 'bold') text = `<strong style="font-weight:bold">${text}</strong>`;
      if (mark.type === 'italic') text = `<em style="font-style:italic">${text}</em>`;
      if (mark.type === 'underline') text = `<u style="text-decoration:underline">${text}</u>`;
    }
    return text;
  }
  function inline(content: EmailInline[] = []): string {
    // Resolve a variable across formatting boundaries: bolding half of {link}
    // must never lose a link the plain-text part carries.
    const source = inlineText(content);
    let offset = 0;
    const runs = content.map(node => {
      const text = node.type === 'hardBreak' ? '\n' : node.text;
      const start = offset;
      offset += text.length;
      return { start, end: offset, marks: node.type === 'text' ? node.marks ?? [] : [] };
    });
    const tokens = [...source.matchAll(VARIABLE)];
    let cursor = 0;
    let runIndex = 0;
    let tokenIndex = 0;
    let html = '';
    while (cursor < source.length) {
      while (runs[runIndex] && runs[runIndex]!.end <= cursor) runIndex++;
      const run = runs[runIndex]!;
      const token = tokens[tokenIndex];
      if (token?.index === cursor) {
        html += styled(has(variables, token[1]!) ? variables[token[1]!]! : token[0], run.marks);
        cursor += token[0].length;
        tokenIndex++;
      } else {
        const end = Math.min(run.end, token?.index ?? source.length);
        html += styled(source.slice(cursor, end), run.marks);
        cursor = end;
      }
    }
    return html;
  }
  function blocks(content: EmailBlock[], list = false): string {
    return content.map(node => {
      if (node.type === 'paragraph' || node.type === 'heading') {
        const source = inlineText(node.content);
        if (source && !replaceEmailVariables(source, variables).trim()) return '';
        if (node.type === 'heading') {
          const tag = `h${node.attrs.level}`;
          const size = { 1: 26, 2: 21, 3: 18 }[node.attrs.level];
          return `<${tag} style="${base}font-size:${size}px;line-height:1.3;font-weight:bold;margin:0 0 14px">${inline(node.content)}</${tag}>`;
        }
        return `<p style="${base}font-size:16px;line-height:1.6;margin:0 0 ${list ? 6 : 16}px">${inline(node.content) || '<br />'}</p>`;
      }
      const tag = node.type === 'orderedList' ? 'ol' : 'ul';
      const start = node.type === 'orderedList' ? ` start="${node.attrs?.start ?? 1}"${node.attrs?.type ? ` type="${node.attrs.type}"` : ''}` : '';
      const listStyle = node.type === 'bulletList' ? 'disc'
        : { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' }[node.attrs?.type ?? '1'];
      return `<${tag}${start} style="${base}font-size:16px;line-height:1.6;margin:0 0 16px;padding-left:24px;list-style-type:${listStyle}">`
        + node.content.map(item => `<li style="margin:0 0 6px">${blocks(item.content, true)}</li>`).join('') + `</${tag}>`;
    }).join('');
  }
  return blocks(document.content);
}
