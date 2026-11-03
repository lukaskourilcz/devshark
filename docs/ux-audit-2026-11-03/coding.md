# Coding challenges: seniorní UX audit

Datum: 3. 11. 2026. Rozsah: `/coding`, tracky JavaScript/TypeScript/React/Algorithms, klasické a debugging úlohy, krátké paths, evolving projekty, FullStack, plánované/aktivní runs a společný workbench. Cílem je najít úlohu, pokračovat v rozdělané práci, pochopit zadání, opravit chyby a bezpečně odeslat řešení.

Audit doporučuje změny, neimplementuje je. Přesun celého briefu do záložky **Description** a odstranění duplicitního **Target** jsou samostatná oprava této větve; nepovažujeme je za otevřené nálezy. Ukázky „po“ jsou návrhy. Anglické texty v nich respektují English-only produkt.

## Metoda a hranice důkazů

- Čtení skutečných rout, copy, registrů, stylů, API klienta a multiplexovaných handlerů. Vstup `client/src/App.tsx:891`; task reads a grading přes `api/quiz/roadmap.ts:1594`; progress, bookmarks a run přes `api/user/[op].ts:114`.
- Browser: lokální production build, Chromium, anonymní uživatel, tmavý režim. `/coding`, `/coding/javascript`, `/coding/fullstack` při 360, 390, 430, 768, 1024, 1280 a 1440 px: všech 21 kombinací mělo h1 a žádný horizontální overflow dokumentu. Deterministické lokální API odpovědi; nejde o produkční účet ani ověření serverových entitlementů.
- Skutečný screenshot FullStack v HTML pochází z preview při 1280 × 1000, reduced motion. Ostatní před/po jsou výslovně označená schémata odvozená ze zdroje.
- `npm run check:design`: PASS, 13 fixture testů, 26 existujících allowlist výjimek. Není to důkaz, že všechny jednotlivé prvky splňují designový kontrakt.
- Přihlášené chybové stavy, task interaction, screen reader, světlý režim, zoom a kontrast nebyly v této části browserem ověřeny. Jejich nálezy jsou statická fakta nebo označená rizika, s navrženou validací.

## Silné stránky, které zachovat

Jeden `CodingWorkbench` pro úlohy a Learn, společný `BriefZone`, skutečné Run/Submit a autoritativní serverový grading. Roving tabindex a arrow keys v záložkách; resizable split s klávesnicí; textové Pass/Fail; stale výsledky po editaci; konflikty draftů s obnovou. URL uchovává filtry, projektové galerie sdílí `EvolvingGallery`, dlouhé seznamy se rozbalují bez vnořeného scrollboxu. Premium je text, nikoliv jen barva; informace o free stages je v galerii řečena jednou.

## Reuse mapa

| Potřeba | Použít existující základ |
| --- | --- |
| Jeden směr pokračování | `NextChallenge`, `currentRunTask`, `evolvingResume`, `taskHref` |
| Unknown/error/empty | `StatePanel`, `LoadingScreen`, existující `coding.planFailed`, `coding.saved.loadFailed` |
| Potvrzení ukončení runu | `BrandedConfirmDialog`; mutation zůstane `useAdvanceSession` |
| Projektové seznamy | `EvolvingGallery`, data z `shared/evolving.ts` a pravidla `shared/tiers.ts` |
| Brief, výsledky, editor | `CodingWorkbench`, `BriefZone`, `DraftNote`, `CodingCompletion` |
| Šířka, ovládání a focus | `pageWidth.ts`, Astryx, sdílené tokeny a 44px hit area |

## Prioritizované nálezy

### C01 · P1 · Pokračování ignoruje rozdělaný projekt a aktivní run

**Ověřeno ve zdroji:** `CodingSection.tsx:72` vyřazuje evolving stages ze `SECTION_INDEX`; `CodingSection.tsx:422` z něj vybírá primární „Your next challenge“. `ChallengeRunPlanner.tsx:115` má vlastní „Continue run“. Domovská stránka tak může současně doporučit jiný klasický task a pokračování skutečné práce nechat níže.

**Dopad:** vracející se learner s aktivním runem nebo částečně splněným projektem musí určit, které Continue znamená jeho práci. Nejde o tvrzení, že se ztrácí draft.

**Nejmenší změna:** resolver pokračování nad existujícími zdroji: aktivní run → explicitně poslední rozpracovaná úloha/projekt, pokud takový údaj existuje → doporučený otevřený task. Neodvozovat „naposledy otevřeno“ pouze z passed stages; pokud chybí spolehlivá recency data, ukázat nabídku rozdělaných projektů. Plánovaný run ponechat plánovaný. Druhé CTA ve planneru nesmí konkurovat primárnímu pokračování.

**Validace:** aktivní/scheduled/finished run; klasická úloha; dva rozdělané projekty; Premium/unknown entitlement; žádný otevřený task; návrat browser Back. Server stále rozhoduje přístup.

### C02 · P1 · Chyba dat se v části stránky tváří jako nulový pokrok

**Ověřeno ve zdroji:** `useStatuses` (`CodingSection.tsx:155`) vrací `planFailed/retryPlan`; CodingHome (`:421`) a FullStack (`:507`) je nepoužívají. Home u selhání progressu zablokuje jen next card, zbytek počítá `passed` z prázdné množiny. FullStack (`:512`) zobrazí error, ale současně galerii s 0 completed. Track má přísnější error branch a výslovný plan warning (`:637`).

**Dopad:** learner může číst neznámý pokrok jako reset a nemusí poznat, že chybí Premium označení. Nejde o bypass serverového oprávnění.

**Nejmenší změna:** sdílet prezentaci unknown/stale/error pro home, track a FullStack. Při dostupné cache ponechat poslední známý pokrok a říct „Progress could not be refreshed.“ Bez dat ukázat „Progress unavailable“, nikdy 0. Převzít existující warning a retry plánu z tracku.

**Validace:** chybný progress bez cache/s cache, chybný plán samostatně, offline→online, retry; čísla a lock stav se nesmí tvářit jako ověřená data.

### C03 · P1 · Saved filtr nerozlišuje prázdnou sbírku od chyby

**Ověřeno ve zdroji:** `CodingSection.tsx:554` převádí chybějící bookmark data na `[]`, `:584` filtruje Saved podle této množiny, `:714` ukáže obecné empty. Track neprezentuje `bookmarks.isError` ani `save.isError`; task screen už tyto chyby zpracovává (`:978`).

**Dopad:** přihlášený learner může uvěřit, že nemá uložené úlohy, nebo že se hvězdička úspěšně uložila.

**Nejmenší změna:** stejné chybové texty a retry jako v task view; při `savedOnly` čekat na známá bookmark data, zachovat poslední seznam při refresh failure. U mutation označit konkrétní dotčený řádek a vrátit jeho focus; neoznačovat úspěch před serverem.

**Validace:** delayed initial read, read failure, stale cache, save/unsave failure, retry, skutečně prázdná sbírka, switch account. Rychlé opakované kliknutí nesmí vytvářet falešný stav.

### C04 · P1 · End/Cancel run se provede bez potvrzení

**Ověřeno ve zdroji:** `ChallengeRunPlanner.tsx:88` volá mutation na `abandoned`; tlačítko ji spouští přímo (`:121`).

**Dopad:** nechtěné kliknutí zruší aktivní frontu nebo naplánovaný run. Již získané výsledky zůstávají, ale kontext fronty je ukončen.

**Nejmenší změna:** znovu použít `BrandedConfirmDialog` pro End/Cancel: „End this run? Completed challenges stay saved.“ / „Cancel this planned run?“; bezpečný sekundární „Keep run“. Samotné Close u již dokončeného runu nepotřebuje další potvrzení.

**Validace:** Escape, focus trap a návrat na opener, safe default focus, failure mutation, double submit, přerušení sítě. Ukončení nastane až po potvrzení.

### C05 · P2 · FullStack stránka nepotvrzuje cíl navigace a opakuje metadata

**Ověřeno v browseru i zdroji:** `/coding/fullstack` má h1 „Evolving challenges“ (`CodingSection.tsx:511`), zatímco FullStack je až h2 galerie. `:359` vypisuje identickou „JavaScript · TypeScript · React · API“ u každého projektu, přestože stejné technologie vysvětluje úvod.

**Nejmenší změna:** h1 „FullStack projects“, jeden krátký lead s vysvětlením sandbox API; galerii dovolit převzít route heading bez druhého úvodního nadpisu. Technologie říct jednou na úrovni seznamu, v řádku ponechat jen odlišující fakt. Free/Premium pravidlo stále jednou, Premium badge u relevantních řádků zachovat.

**Validace:** z Coding feature linku, přímý vstup a Back; právě jeden h1, stejný katalog/pořadí/entitlementy; čitelnost při 360–1440 px.

### C06 · P2 · Stage kontext se opakuje ve dvou vrstvách

**Ověřeno ve zdroji:** `CodingSection.tsx:974` píše název projektu a „Stage n of total“ nad navigací; `CodingWorkbench.tsx:1161` generuje stejné stage metadata pro brief. Číslo je ještě v označené stage navigaci.

**Nejmenší změna:** jeden trvalý kontext „Project title · Stage 3 of 10“ se stage navigation. Description začne názvem konkrétní úlohy a unikátním zadáním. Stage nav má stále `aria-current="step"` a přístupná jména; informace pro asistivní technologie nesmí zmizet.

**Validace:** krátký path, dlouhý evolving, FullStack napříč JS/TS/React, přímý odkaz, narrow/editor waiting state, dokončení; project context zůstane čitelný i při přepnutí z Description do Results.

### C07 · P2 · Zamčená stage neříká konkrétní podmínku otevření

**Ověřeno ve zdroji:** progression locked stage (`CodingSection.tsx:789`) používá disabled Button s názvem pouze „Stage n of total“; Premium větev má focusable `LockedButton` a vysvětlení. Stage tooltip neobsahuje prerequisite.

**Nejmenší změna:** přidat konkrétní text „Complete stage 2 to unlock stage 3“ do dostupného popisu, vizuální text pro aktuální další lock a focusable unavailable pattern ze sdíleného základu. Nespouštět navigaci ani předstírat Premium lock, když chybí splněný předchůdce.

**Validace:** pouze klávesnice a screen reader, všechny předchozí passed/nepassed, Premium versus progression lock, 12-stage horizontální navigace, focus v zorném poli. Jde o zdrojově doloženou slabinu informace; skutečné screen-reader chování čeká na ověření.

### C08 · P2 · Jeden filtr míchá činnost uživatele se způsobem hodnocení

**Ověřeno ve zdroji:** `CodingSection.tsx:580` vědomě kombinuje `formatOf(task)` a `task.verify`; možnosti jsou „Graded by tests“ a „Find the bug“ (`:679`, `:680`). Debugging může být současně graded by tests, takže možnosti nejsou vzájemné alternativy.

**Nejmenší změna:** použít osvědčený selector, ale nabízet konzistentní task typy „Any task type“, „Write code“, „Find the bug“. Je-li ověření skutečně variabilní, ukázat ho jako informaci v Description; nevytvářet další filtr, který nic užitečného nezužuje. Zachovat kompatibilitu starých URL.

**Validace:** průnik debug + tests, React/TS a klasické write tasky; počty odpovídají výsledkům, reset, reload a staré `?format=tests` odkazy.

### C09 · P2 · Opakovaná Start/Continue tlačítka postrádají název projektu

**Ověřeno ve zdroji a viditelném UI:** `CodingSection.tsx:367` předává `FadeFinCta` jen obecný `action`. Název článku (`:355`) je při čtení kontextu užitečný, ale samostatný seznam ovládacích prvků může nabídnout několik nerozlišitelných „Start“.

**Nejmenší změna:** zachovat krátký viditelný text, dostupné jméno rozšířit např. „Start Link shortener“ přes podporované `aria-label` nebo vazbu na h3; přístupné jméno musí obsahovat viditelný verb. Upřednostnit existující CTA API před další komponentou.

**Validace:** accessibility tree, seznam tlačítek screen readeru a voice control; start/continue/review stavy, dlouhý název. Není potřeba změnit vzhled nebo přidat další štítek do každého řádku.

### C10 · P2 · Previous requirements má menší ovládací plochu než kontrakt

**Ověřeno ve stylech:** `Coding.css:425` definuje summary na `min-height: 32px` mimo `.ss-compact`. To je riziko menší touch plochy; skutečná vykreslená výška závisí na obsahu a viewportu.

**Nejmenší změna:** použít společný 44px control token/hit area pro `<summary>`, ponechat nativní details, focus ring a hierarchii menších předchozích briefů. Nezvyšovat velikost veškerého textu ani přidávat card.

**Validace:** změřit bounding box na touch 360/390/430; Enter/Space, focus-visible, dlouhý summary, 200/400% zoom, dark/light, reduced motion. Předchozí požadavky jsou stále skutečné zadání a nesmějí být odstraněny jako duplicita.

## Blockery a nejistoty

P0 porucha nebo ztráta dat nebyla prokázána. C01–C04 jsou P1 workflow/stavové chyby; C05–C10 jsou P2 hierarchie, informační a accessibility opravy. Domněnky o rychlosti dokončení, retenci, konverzi či výsledcích screen readeru zde nejsou prezentovány jako naměřená fakta.

## Doporučené pořadí implementace

1. `CodingSection.tsx`: opravit C02/C03 s existujícími stavy, copy a cache. Cílené testy se selháním API a obnovou.
2. `ChallengeRunPlanner.tsx`: C04 přes existující dialog; pak C01 resolver nad existujícím session/progress modelem. Žádný nový backend ani registry.
3. `CodingSection.tsx` + route copy: C05/C06/C08/C09. Jedna informace na jednom místě; tracky a úlohy zůstávají na společných komponentách.
4. `StageNav` + `Coding.css`: C07/C10; ověřit keyboard, touch a reflow. Nepřidávat další UI knihovnu.
5. Projít Classic → Debug → Evolving → FullStack → completion, porovnat se Learn coding activity a udržet společný workbench. Povinné repository release checks vykonat při implementaci; tento audit není release certifikace.

## Validační matice

| Oblast | Provedeno v tomto auditu | Nutné při implementaci |
| --- | --- | --- |
| Home, JavaScript track, FullStack | Chromium, anonymně, dark, 7 šířek, h1 a overflow OK | Light, 200/400% zoom, long names, visual focus |
| FullStack pojmenování | Screenshot 1280 × 1000 + zdroj | Jediný h1, správný cíl, bez opakovaných technologií |
| Classic / TS / React workbench | Zdroj, sdílený runner/tab/draft tok | Run/Submit, compile/runtime/hidden errors, stale výsledky, tab keyboard |
| Debugging / short paths / evolving / FullStack stages | Zdroj katalogu a navigace | 5/10/12 stages, carry-forward draft, prerequisite/Premium, všechny šířky |
| Progress/plan/saved failure | Statická analýza | API fixtures se 503/402/401, stale cache, retry, offline→online |
| Active/planned run | Statická analýza | Resume resolver, dialog cancel/confirm, focus, end failure |
| Draft/auth/session | Existující `DraftNote`, refresh a account epoch zkontrolovány | Expired session, sign-out, account switch, conflicting draft, task_changed |
| Design contract | PASS: 13 fixture testů; 26 allowlisted | Konkrétní 44px bounds, obě témata, reduced motion, routes-axe |

Viz [HTML s ukázkami před/po](coding.html). Screenshot má pouze ilustrativní lokální stav; serverová pravidla přístupu, skóre, XP a freemium zůstávají nedotčena.
