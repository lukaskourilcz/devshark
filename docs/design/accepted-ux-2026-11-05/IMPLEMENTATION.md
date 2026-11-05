# Accepted platform UX implementation — 5 November 2026

The owner authorized implementation of the accepted first-round baseline and second-round revisions, including the descriptions previously earmarked for later Opus issues. No handoff issue is required. Original logo, Quiz pills/logos and ocean/sharks stay.

## Overrides

- Breadcrumbs render only with at least two values. Keep Coding / JavaScript, including its current leaf; do not render root-only breadcrumbs.
- Coding Description: smaller text, authored paragraphs/line breaks, readable spacing. Level checkmark requires both passed status and a saved solution; completion status alone is insufficient.
- Daily: two to three lines explaining the category and current concept, reusing safe existing introduction/context. Never expose an answer or post-submit explanation before grading.
- Profile: reject equal-height stretched cards. Keep natural heights and balanced placement; Account stays left after Track and Sections.
- No optional-reading warning or Skip to questions, no placement-restart copy change, no new End/Cancel confirmation.
- EXT-03 (Premium/auth/public redesign) remains rejected. Shared page gutters still apply as explicitly accepted.

## Delivery checklist

- [x] SYS-01 — Šířka podle úkolu, společné okraje
- [x] SYS-02 — Jedna pracovní typografická škála
- [x] SYS-03 — Breadcrumbs jako kontext, ne další velký nadpis
- [x] SYS-04 — Společný režim soustředění pro všechny aktivity
- [x] SYS-05 — Kompaktnější vzhled bez menších zásahových ploch
- [x] COD-01 — Jeden workspace a pravý společný tabstrip
- [x] COD-02 — CamelCase název challenge přímo v breadcrumbs editoru
- [x] COD-03 — Nahoře nástroje, dole pouze Run · Hint · Submit
- [x] COD-04 — Solution pouze po oprávněném serverovém Submit
- [x] COD-05 — Desired complexity úplně na konci Description
- [x] COD-06 — Stages pod kartou, žádný titul před editorem
- [x] COD-07 — Uklidit spodní Coding: formáty oddělit lokální navigací
- [x] COD-08 — Next challenge ve světlém režimu dostane čitelný povrch
- [x] COD-09 — Jazykový seznam: stabilní filtry a kompaktní řádky
- [x] LEA-01 — Témata vlevo, vybraný kurz a Continue vpravo
- [x] LEA-02 — Mapa bez druhé konkurenční navigace po partech
- [x] QUI-01 — Setup do přehledných skupin; pills s logy beze změny
- [x] QUI-02 — Otázka využije prostor bez velkého prázdného bloku
- [x] QUI-03 — Výsledky: souhrn nahoře, review v jednom čitelném toku
- [x] TOD-01 — Learning paths jako skutečný resume řádek
- [x] PRO-01 — Account vlevo přímo pod Track and Sections
- [x] PRO-02 — Progress metriky zmenšit na souhrn, nastavení na řádky
- [x] PTH-01 — FDE modul: přehled vedle aktivit, cíle na vyžádání
- [x] EXT-01 — Challenge, Play, Cards a Typing: stejný vstup a aktivní režim
- [x] EXT-02 — Leaderboard a sbírky: pracovní přehled, ne další hero
- [x] EXT-03 — Premium, auth a textové stránky mají rozdílný účel (rejected; do not implement)
- [x] STA-01 — Společné stavy a implementační pořadí

Product implementation shipped in PR #603, merged at `d89d9d9b539a66bcf6732a1adc27c00591e8c86f`. Required CI is green and READY production `dpl_AngDh7NpaE2NKEB4eXHkpN4e9bAv` serves that commit on devshark.app. A local read-only fixture sweep covered Quiz setup/active/results, Learn, Today, Profile and an enrolled FDE module at 360, 768, 1280 and 1440 CSS px in light and dark (56 cells, no horizontal overflow or page errors). Axe ran on all 28 phone/notebook cells with no WCAG 2 A/AA, 2.1 AA or 2.2 AA findings. Coding editor checks additionally covered 360–1440 px in both themes, local workers, server submissions, keyboard navigation, drafts and stage handoff. These are local fixtures, not production transactions or a physical-device claim.

The shipped Daily question bank has introductions for all 2,072 questions across the 15 Daily categories. The page reuses those public introductions and a shared category introduction; it never reads pre-grade explanations or raw answer-bearing tags. The legacy default-category subset remains wire-compatible for older clients but its obsolete admin control is removed.

The implementation preserves grading, plan gates, server XP and saved drafts. The only added server read returns the identifiers of passed stages with nonblank, caller-owned saved code, never the code itself. Product quality run `42042427769` passed every required job on frozen head `56f22bcdfeb71184c22b299c9412d685168c7709`. The post-deploy read-only guest smoke passed 24 route/theme checks plus two local Coding Runs at 1280×680, without page errors, horizontal overflow or app writes. See the release-acceptance entry for the full evidence and its limits.
