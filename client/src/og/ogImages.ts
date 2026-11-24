// Share images the build draws (#239): one per coding task, one per day of the
// question of the day, and one for /daily itself. Each is 1200 × 630 PNG,
// the size Threads, Instagram, LinkedIn and X read from og:image.
//
// Build-time only (vite.config.ts imports this; the app never does). The
// cards are laid out with Satori and rasterised with resvg, from the V9 kit's
// own logo and fin SVGs (never redrawn) and the brand's Manrope and Inter,
// read from @fontsource's WOFF files. Text is deterministic and factual:
// titles, tracks, difficulty, dates and counts from the catalogue, nothing
// about a learner. A rendered card is cached under node_modules/.cache by the
// hash of what it shows, so a second build in the same checkout (the bundle
// budget's) copies instead of drawing again.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { compressSharePng } from './png';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Bump when the layout or encoding changes, so cached cards are drawn again. */
const LAYOUT_VERSION = 3;

const INK = '#132019';
const INK_700 = '#3C4F43';
const PAPER = '#F3F6F1';
const GREEN = '#2D7A2D';
const LINE = '#DCE7E0';

export type OgCard =
  | { kind: 'coding'; title: string; track: string; difficulty: string; free: boolean; freeCount: number; totalCount: number }
  | { kind: 'daily'; track: string; dateLabel: string }
  | { kind: 'daily-home' };

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node =>
  ({ type, props: { style: { display: 'flex', ...style }, ...(children === undefined ? {} : { children }), ...extra } });

const require = createRequire(import.meta.url);
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const brandAssets = path.join(clientRoot, 'src/og/assets');
const kitSvg = (name: string) => {
  // The kit files carry a C2PA manifest in <metadata>; the drawing is the rest.
  const svg = readFileSync(path.join(brandAssets, name), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

let assets: { fonts: { name: string; data: Buffer; weight: 500 | 600 | 800; style: 'normal' }[]; logo: string; fin: string } | null = null;
function loadAssets() {
  if (assets) return assets;
  // Named in full so the dependency check sees both packages.
  const packages = { inter: require.resolve('@fontsource/inter/package.json'), manrope: require.resolve('@fontsource/manrope/package.json') };
  const font = (pkg: keyof typeof packages, file: string) => readFileSync(path.join(path.dirname(packages[pkg]), 'files', file));
  assets = {
    fonts: [
      { name: 'Inter', data: font('inter', 'inter-latin-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'Inter', data: font('inter', 'inter-latin-600-normal.woff'), weight: 600, style: 'normal' },
      { name: 'Manrope', data: font('manrope', 'manrope-latin-800-normal.woff'), weight: 800, style: 'normal' },
    ],
    logo: `data:image/svg+xml;base64,${readFileSync(path.join(brandAssets, 'navbar-logo-ink.svg')).toString('base64')}`,
    fin: kitSvg('devshark-fin-wave-green.svg'),
  };
  return assets;
}

/** Title size by length, so a long task name stays within three lines. */
const titleSize = (text: string) => (text.length > 60 ? 56 : text.length > 34 ? 66 : 80);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function layout(card: OgCard): Node {
  const { logo, fin } = loadAssets();
  const pill = card.kind === 'coding' ? 'Coding challenge' : 'Question of the day';
  const eyebrow = card.kind === 'coding'
    ? `${card.track} · ${card.difficulty}${card.free ? ' · Free' : ''}`
    : card.kind === 'daily' ? card.dateLabel : 'devShark';
  const title = card.kind === 'coding'
    ? clip(card.title, 90)
    : card.kind === 'daily' ? `${card.track} question of the day` : 'One developer question a day';
  const footer = card.kind === 'coding'
    ? `${card.freeCount} of ${card.totalCount} tasks free · devshark.app`
    : card.kind === 'daily' ? 'Check your answer on devshark.app/daily' : 'A new track every day · devshark.app/daily';

  return el('div', { width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', justifyContent: 'space-between', background: PAPER, padding: '56px 72px', fontFamily: 'Inter' }, [
    el('div', { alignItems: 'center', justifyContent: 'space-between' }, [
      el('img', { width: 330, height: 44 }, undefined, { src: logo, width: 330, height: 44 }),
      el('div', { alignItems: 'center', height: 48, padding: '0 22px', borderRadius: 24, border: `2px solid ${LINE}`, background: '#FFFFFF', color: INK, fontSize: 24, fontWeight: 600 }, pill),
    ]),
    el('div', { flexDirection: 'column', gap: 18, maxWidth: 1000 }, [
      el('div', { color: GREEN, fontSize: 30, fontWeight: 600 }, eyebrow),
      el('div', { color: INK, fontFamily: 'Manrope', fontWeight: 800, fontSize: titleSize(title), lineHeight: 1.08, letterSpacing: -1.5 }, title),
    ]),
    el('div', { alignItems: 'flex-end', justifyContent: 'space-between' }, [
      el('div', { color: INK_700, fontSize: 28, fontWeight: 500, paddingBottom: 6 }, footer),
      el('img', { width: 112, height: 87 }, undefined, { src: fin, width: 112, height: 87 }),
    ]),
  ]);
}

/** The PNG of one card. */
export async function renderOgCard(card: OgCard): Promise<Buffer> {
  const svg = await satori(layout(card) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadAssets().fonts });
  return compressSharePng(Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng()));
}

const cacheDir = path.join(clientRoot, 'node_modules/.cache/devshark-og');

/** Write a card to `file`, drawing it only when the cache has no copy. */
export async function writeOgCard(file: string, card: OgCard): Promise<'drawn' | 'cached'> {
  const key = createHash('sha256').update(JSON.stringify({ LAYOUT_VERSION, card })).digest('hex').slice(0, 32);
  const cached = path.join(cacheDir, `${key}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  if (existsSync(cached)) {
    await writeFile(file, await readFile(cached));
    return 'cached';
  }
  const png = await renderOgCard(card);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, png);
  await writeFile(file, png);
  return 'drawn';
}
