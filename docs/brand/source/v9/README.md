# devShark brand kit · V9 (chosen 27 September 2026)

Every file here comes from the exact source geometry. The wordmark text is outlined, and the PNGs have transparent backgrounds. The generator, the brand manual, the change list and the social templates stay in the owner's archive and are not in this repository. The rules, in English, are in [`docs/brand/brand-guidelines.md`](../../../../docs/brand/brand-guidelines.md).

## recommended/: the brand family (green #2D7A2D · ink #132019 · white #FFFFFF, each as SVG and PNG)

| File | Use | Minimum size |
|---|---|---|
| [`recommended/devshark-logo-horizontal-*`](recommended/devshark-logo-horizontal-green.svg) | primary logo | 160 px / 35 mm wide |
| [`recommended/devshark-logo-horizontal-small-*`](recommended/devshark-logo-horizontal-small-green.svg) | same geometry, heavier wave | 100–160 px / 20–35 mm |
| [`recommended/devshark-logo-compact-*`](recommended/devshark-logo-compact-green.svg) | navigation, mobile, footers | 18 px high |
| [`recommended/devshark-logo-stacked-*`](recommended/devshark-logo-stacked-green.svg) | square formats: avatar, sticker, mug | 120 px wide |
| [`recommended/devshark-fin-wave-*`](recommended/devshark-fin-wave-green.svg) | standalone symbol with the wave | 20 px / 6 mm |
| [`recommended/devshark-fin-clean-*`](recommended/devshark-fin-clean-green.svg) | clean fin: favicon, icon, embroidery, post corner | 12 px / 4 mm |

PNG widths: horizontal 2400 px, stacked 1600 px, symbols 1024 px.

## favicon/

- [`favicon/favicon.svg`](favicon/favicon.svg), [`favicon/favicon-white.svg`](favicon/favicon-white.svg) (dark browser themes)
- `favicon/favicon-16.png`, `-32`, `-48`, `-180`, `-192`, `-512`: transparent, green fin
- [`favicon/favicon.ico`](favicon/favicon.ico): 16 + 32 + 48 (PNG layers)
- [`favicon/app-icon.svg`](favicon/app-icon.svg), `favicon/app-icon-180.png`, `-192`, `-512`: white fin on a green tile; the platform adds the corner radius

The app serves copies of these files from the root of `client/public/`: `/favicon.ico`, `/favicon.svg`, `/favicon-white.svg`, `/favicon-16.png`, `/favicon-32.png`, `/favicon-48.png`, `/apple-touch-icon.png` (= `app-icon-180.png`), `/icon-192.png` (= `app-icon-192.png`), `/icon-512.png` (= `app-icon-512.png`) and `/icon.svg` (= `app-icon.svg`).

`client/index.html` links them:

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" media="(prefers-color-scheme: light)" />
<link rel="icon" type="image/svg+xml" href="/favicon-white.svg" media="(prefers-color-scheme: dark)" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
```

The web manifest (`client/vite.config.ts`) uses `/icon-192.png` and `/icon-512.png`.

## Quick rules

- Always write **devShark**. Fin on the left, tip pointing left, one wave, transparent cut-out.
- Green on white or light backgrounds, white on ink or green, ink for one-colour print. No gradients, shadows or 3D.
- Clear space: the height of the letter d on every side.
- Favicon and embroidery: the clean fin only.
- Print sizes (proposals; confirm with the supplier's template): T-shirt 80 mm, hoodie 90 mm, mug 85 mm, cap (fin) 35 mm, sticker 100 mm.
