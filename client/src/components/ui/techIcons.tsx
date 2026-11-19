// Technology glyphs for quiz categories — real brand logos instead of
// anonymous colour dots, so the setup form reads as OUR product.
//
// Sources mirror the owner's portfolio (nxt-portfolio): full-colour devicon
// SVGs statically imported (Vite bundles only these ~12 files, never the
// whole icon set), plus two single-colour simple-icons paths the portfolio
// inlines (Claude for AI, React Hook Form) that devicon doesn't carry.
// Categories without a real logo (e.g. "General", "Dev World" — and every
// non-tech subject) fall back to their brand-colour dot, presented in the
// same slot so rows stay aligned.

import javascriptIcon from 'devicon/icons/javascript/javascript-original.svg';
import typescriptIcon from 'devicon/icons/typescript/typescript-original.svg';
import html5Icon from 'devicon/icons/html5/html5-original.svg';
import css3Icon from 'devicon/icons/css3/css3-original.svg';
import reactIcon from 'devicon/icons/react/react-original.svg';
import nextjsIcon from 'devicon/icons/nextjs/nextjs-plain.svg';
import nodejsIcon from 'devicon/icons/nodejs/nodejs-original.svg';
import gitIcon from 'devicon/icons/git/git-original.svg';
import postgresqlIcon from 'devicon/icons/postgresql/postgresql-original.svg';
import dockerIcon from 'devicon/icons/docker/docker-original.svg';
import jestIcon from 'devicon/icons/jest/jest-plain.svg';

interface TechIcon {
  src: string;
  /** Monochrome logos flip to white in dark mode. */
  mono?: boolean;
}

const TECH_ICONS: Record<string, TechIcon> = {
  html: { src: html5Icon },
  css: { src: css3Icon },
  javascript: { src: javascriptIcon },
  typescript: { src: typescriptIcon },
  react: { src: reactIcon },
  nextjs: { src: nextjsIcon, mono: true },
  nodejs: { src: nodejsIcon },
  git: { src: gitIcon },
  databases: { src: postgresqlIcon },
  devops: { src: dockerIcon },
  testing: { src: jestIcon },
};

// Single-colour brand paths (simple-icons, via the portfolio's brand-icons).
const BRAND_PATHS: Record<string, string> = {
  'dsa-advanced': 'M3 3h4v4H3zm14 0h4v4h-4zM10 17h4v4h-4zM6 8l5 8 1-1-5-8zm12 0-5 8-1-1 5-8z',
  ai: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
};

/**
 * The category's visual mark, in a fixed square slot so mixed rows align:
 * a real tech logo where one exists, the category's brand-colour dot
 * otherwise.
 */
export function CategoryGlyph({ category, color, size = 20 }: { category: string; color: string; size?: number }) {
  const tech = TECH_ICONS[category];
  if (tech) {
    return (
      <img
        src={tech.src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        decoding="async"
        className={tech.mono ? 'ss-tech-mono' : undefined}
        style={{ display: 'block', flexShrink: 0 }}
      />
    );
  }
  const path = BRAND_PATHS[category];
  if (path) {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0, color }}>
        <path d={path} fill="currentColor" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 4, background: color, display: 'block' }} />
    </span>
  );
}
