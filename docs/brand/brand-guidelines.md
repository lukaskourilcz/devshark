# devShark brand guidelines (V9)

## The navigation logo

The header and the mobile menu show `BrandLogo`: the V9 fin and wave beside a plain heavy **devShark** wordmark the owner chose on 12 October 2026. Everywhere else the V9 kit applies.

`client/src/assets/brand/devshark-wordmark.svg` holds the wordmark as deterministic outlines traced from the owner's raster reference, not a font: 1347 × 229 units, with "dev" and "Shark" as separate solid fills, a normal k and an uncut S. The outlines are a trace; no font or vector master exists in the repository.

The fin paths and wave stroke are the V9 ones, unchanged. The fin and wave stand as tall as the wordmark: the fin tip aligns with the top of the lettering and the bottom of the wave stroke with its bottom. The gap is 28% of the wordmark height. The fin and "dev" use `--brand-accent`; "Shark" uses `--brand-ink` in light mode and white in dark mode. The logo has fixed dimensions (about 166 × 22 px in the header, 151 × 20 px in the mobile menu), needs no font and takes the home link's accessible name. The two lettering paths share one hashed SVG request, cached apart from JavaScript, and the SVG `use` instances inherit their theme colours from `BrandLogo`.

`node scripts/render-og-image.mjs --logo-svg --out client/src/og/assets/navbar-logo-ink.svg` exports the same lockup to the [approved share-image source](../../client/src/og/assets/navbar-logo-ink.svg), which the share-image build reads.

## The V9 kit

The kit lives in [`docs/brand/source/v9/`](source/v9/README.md). Compared with the [earlier one-wave revision](source/devshark-approved/README.md), V9 moves the fin up to the top ascender line, draws the wave as thick as the letter stems, and sets the lettering optically bolder with rounded corners. The owner's generator produced every file from one geometry; the lettering is outlines, so no file depends on a font, and every PNG has a transparent background. The generator, the HTML brand manual and the change list stay in the owner's archive.

The source archive keeps the original artwork and provenance. The share-image build reads the [approved lockup](../../client/src/og/assets/navbar-logo-ink.svg) and [V9 fin](../../client/src/og/assets/devshark-fin-wave-green.svg) from the client. Their original archive paths link to those files. The manual image regeneration script reads the [Open Graph background](source/og/architecture-current.webp) from the archive. Vite serves the optimized root icons and final share images from `client/public/`; it does not copy the source archive into the website. Optimize served copies while preserving their geometry, `viewBox` and externally referenced SVG IDs.

### Files

`recommended/` holds the brand family in green `#2D7A2D`, ink `#132019` and white `#FFFFFF`, each as SVG and PNG.

| File | Use | Minimum size |
|---|---|---|
| `devshark-logo-horizontal-*` | Primary logo | 160 px / 35 mm wide |
| `devshark-logo-horizontal-small-*` | Same geometry with a heavier wave, for small placements | 100–160 px / 20–35 mm |
| `devshark-logo-compact-*` | Navigation, mobile, footers | 18 px tall |
| `devshark-logo-stacked-*` | Square formats: avatar, sticker, mug | 120 px wide |
| `devshark-fin-wave-*` | The symbol on its own, with the wave | 20 px / 6 mm |
| `devshark-fin-clean-*` | Clean fin: favicon, app icon, embroidery, post corners | 12 px / 4 mm |

PNG widths: 2400 px for horizontal logos, 1600 px for stacked, 1024 px for symbols.

`favicon/` holds the browser and install icons:

- `favicon.svg` (green) and `favicon-white.svg` (for dark browser themes).
- `favicon-16.png`, `-32`, `-48`, `-180`, `-192`, `-512`: transparent, green fin.
- `favicon.ico` with 16, 32 and 48 px PNG layers.
- `app-icon.svg`, `app-icon-180.png`, `-192`, `-512`: a white fin on a square green tile. The platform adds the corner radius.

The app serves these icons from the root of `client/public/`: `/favicon.ico`, `/favicon.svg`, `/favicon-white.svg`, `/favicon-32.png`, `/apple-touch-icon.png` (the 180 px app icon), `/icon-192.png`, `/icon-512.png` and `/icon.svg` (the app icon). The ICO retains its 16, 32 and 48 px layers; separate 16 and 48 px PNG copies stay in the source archive. `client/vite.config.ts` generates the manifest and references the app icons. `scripts/render-og-image.mjs` renders `/og-image.png` from the approved lockup and archived background.

## Rules

- Write the name as **devShark**: lowercase d, e, v, h, a, r, k and one capital S. Uppercase labels keep it that way (`.ss-brand-name`, `BrandCase`).
- The fin stands left of the wordmark with its tip pointing left. One wave, cut out of the fin as a transparent notch.
- Use green on white or light backgrounds, white on ink or green, and ink for one-colour print. No gradients, shadows or 3D.
- Clear space on every side equals the height of the letter d.
- The favicon and embroidery use the clean fin only.
- Below 100 px of width, use the clean fin instead of a logo.
- Never redraw the fin. Code copies the kit paths from `client/src/components/brandGeometry.ts`; `SharkFin`, `BrandLogo`, the share card and the icons all start there.
- The wave belongs to the logo and to the waterline marks (`<Kicker>`, `Waterline`). Every other fin is the clean fin.
- devShark ships no AI feature. Brand copy makes no AI claims.

### In the app

| Place | Mark | Why |
|---|---|---|
| Header | `BrandLogo`, compact, 22 px | The first place a visitor meets the brand on every page. |
| Mobile menu | `BrandLogo`, compact, 20 px | The menu covers the header, so it repeats the logo. |
| Loader, study-mode loader | `SwimmingShark`, clean fin | A loader is an icon, and a logo animating in a loop wears thin. |
| Footer ocean | `Waterline` with clean `SwimmingFin`s | The footer carries only legal links, devShark's own social profiles and settings; the fins are decoration. |
| Page headers (public info, GitHub settings) | `SwimmingFin`, clean fin, 26 px | An icon beside a kicker, under the header logo. |
| Buttons, cards, progress, lives, empty states | `SharkFin`, clean fin | Icons and decoration. |
| Result share card | Compact logo, 44 px, and a clean fin on the waterline | The card leaves the app, so the brand appears there first. |
| Favicon, app icons | Clean fin | The kit reserves the favicon for the clean fin. |
| Open Graph image | Horizontal logo at 46% of 1200 px on `#F3F6F1` | A link preview is where most people meet the brand first. |

## Colors

| Role | Token | HEX | RGB |
|---|---|---|---|
| Primary green | `--brand-accent` (default) | `#2D7A2D` | 45, 122, 45 |
| Green, hover and pressed | `--brand-green-800` | `#236123` | 35, 97, 35 |
| Green tint, active item | `--brand-green-100` | `#E3EFE1` | 227, 239, 225 |
| Ink, primary text and ink backgrounds | `--brand-ink` | `#132019` | 19, 32, 25 |
| Ink 700, secondary text | `--brand-ink-700` | `#3C4F43` | 60, 79, 67 |
| Ink surface, cards on ink | `--brand-ink-surface` | `#1B2A21` | 27, 42, 33 |
| Pale background | (manifest `background_color`) | `#F3F6F1` | 243, 246, 241 |
| Line | `--brand-line` | `#D6DED3` | 214, 222, 211 |
| White | | `#FFFFFF` | 255, 255, 255 |

The tokens live in `client/src/styles/astryx-theme.css`. Components read the green through `var(--brand-accent)`, never as a literal.

### Contrast

WCAG 2.2 ratios, computed from the relative luminance of each pair. AA asks for 4.5:1 for body text and 3:1 for large text (24 px, or 18.7 px bold) and graphics.

| Foreground on background | Ratio | Passes |
|---|---|---|
| Green `#2D7A2D` on white | 5.34:1 | AA text |
| Green on pale `#F3F6F1` | 4.90:1 | AA text |
| Green on green tint `#E3EFE1` | 4.50:1 | AA text, with no margin |
| White on green | 5.34:1 | AA text |
| Green 800 `#236123` on white | 7.48:1 | AAA text |
| Green 800 on green tint | 6.31:1 | AA text |
| Ink `#132019` on white | 16.82:1 | AAA text |
| Ink on pale | 15.43:1 | AAA text |
| Ink on green tint | 14.18:1 | AAA text |
| Ink 700 `#3C4F43` on white | 8.78:1 | AAA text |
| Ink 700 on pale | 8.05:1 | AAA text |
| Ink 700 on green tint | 7.40:1 | AAA text |
| White on ink | 16.82:1 | AAA text |
| White on ink surface `#1B2A21` | 15.00:1 | AAA text |
| Pale on ink | 15.43:1 | AAA text |
| Green on ink | 3.15:1 | Large text and graphics only |
| Green on ink surface | 2.81:1 | Fails; use white or the dark theme's bright accent |
| Dark theme accent `#4CAF50` on ink | 6.05:1 | AA text |
| Line `#D6DED3` on white | 1.38:1 | Decoration only, never a boundary that carries meaning |

On ink, set the logo in white. The green logo on ink reaches only 3.15:1.

## Typography

| Face | Weights | Use |
|---|---|---|
| Manrope | 800, 700 | Headings and display. The logo lettering started as Manrope ExtraBold and now ships as outlines. |
| Inter | 400, 500 | Body text and interface. |
| JetBrains Mono | 400 | Code in marketing and print material. |

The app loads Manrope Variable and Inter Variable through Fontsource, one Latin file each (`manrope-latin-wght-normal.woff2`, 24.3 kB; `inter-latin-wght-normal.woff2`, 47.1 kB). A variable font carries its whole weight axis in one file, so the browser downloads the same bytes whichever weights the CSS asks for. Code in the app uses the system monospace stack.

## Applications

Placement proposals. The supplier's template decides the final size, bleed, cut lines and embroidery digitising.

| Item | Mark | Size |
|---|---|---|
| T-shirt, left chest | Horizontal or compact logo | 80 mm wide |
| Hoodie | Horizontal logo | 90 mm wide |
| Mug | Horizontal or stacked logo | 85 mm wide |
| Cap, embroidered | Clean fin | 35 mm wide |
| Sticker | Stacked or horizontal logo | 100 mm |

Spreadshop prints and ships devShark merchandise. Merchandise is paused (`MERCH_ENABLED` in `shared/rewards.ts`), so these placements wait for its return.
