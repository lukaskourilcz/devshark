# Learn — seniorní UX audit

Datum: 3. 11. 2026. Stav: audit a návrhy, nikoli implementované změny aplikace. [Vizuální report](learn.html).

## Rozsah a cíl uživatele

Začínající i vracející se vývojář potřebuje najít další dostupný krok, pochopit podmínky postupu a dokončit jej bez ztráty orientace. Zahrnuto: `/learn/web-developer`, `/learn/software-engineer`, `/learn/forward-deployed-engineer`, `/learn/big-o`, volitelné čtení, otázky, výsledky, placement a vstup do FDE modulu. Route map: `client/src/App.tsx:79`, `client/src/App.tsx:884`; FDE má vlastní workspace `client/src/components/paths/LearningPathScreens.tsx:664`.

Zjištění jsou odvozena z aktuálního kódu, nikoli ze starých auditů. Rozlišuji staticky ověřené chování od prohlížečové validace. Před/po schémata v HTML jsou označená jako rekonstrukce a návrh; nejsou vydávána za fotografie produkce. Níže jsou odděleně zapsané provedené prohlížečové kontroly. Bez uživatelského výzkumu neuvádím smyšlené konverze, časové úspory ani četnost problémů.

## Co zachovat

- Tři sekce, topic rail a jediný primární krok; výrazné zjednodušení už obsahuje aktuální implementace (`Roadmap.tsx:1017`, `learn/SectionSwitcher.tsx:128`). Nevracet opakované názvy sekcí ani samostatné karty pro každý status.
- Sdílené `QuestionShell`, `QuestionHeader`, `AnswerOptionList` a zpětnou vazbu pod odpověďmi (`learn/LessonRunner.tsx:741`).
- Focus po otevření a zavření úrovně a při změně výsledku; nejde o nově chybějící funkce (`Roadmap.tsx:800`, `Roadmap.tsx:898`, `learn/LessonRunner.tsx:480`).
- Viditelné důvody Premium, serverové ověření odpovědí i otevření obsahu a oddělení čtení od zaznamenaného pokroku. Návrhy nemění nárok na XP, skóre, mince ani obsah zdarma.
- Stacked section switcher na telefonu, 44px cíle a nekódové informace o mastered/cleared (`learn/SectionSwitcher.tsx:8`, `Roadmap.tsx:1342`).

## Reuse mapa

| Potřeba | Existující zdroj |
| --- | --- |
| Hlavička Learn | `learn/LearnPageHeader.tsx`, sdílený `PageHeader` rám |
| Další krok úrovně / checkpointu | `Active`, `nextAfter`, `openOrUpgrade` v `Roadmap.tsx`; žádná druhá sada unlock pravidel |
| Zpětná vazba a recovery | `StatePanel`, `ErrorRetry`, `learn/lessonParts.tsx:67` |
| Ovládání, focus, potvrzení | Astryx `Button`, `SwimCta`, `BrandedConfirmDialog` |
| Umístění témat a pokrok | `shared/learn-sections.ts`, `shared/progression.ts`, `learn/sections.ts` |
| Přístup a Premium | `shared/tiers.ts`, `useContentLocks`; nesmí je rozhodovat návrhový mockup |
| Čtení a FDE obsah | `LearnLesson`, `LessonView`, `PathCard`, `ActivityRow`, stávající workspace |

API tok: mapu/lekce/úrovně čte `client/src/lib/roadmap.ts:111`, odpovědi a dokončení odesílá `:134` a `:146`, placement používá `Roadmap.tsx:1714`; vše patří existujícímu `api/quiz/roadmap.ts` (`:155`, `:713`, `:1699`). Audit nenavrhuje nový endpoint.

## Blokery

Neprokázán plošný UX blocker. L01 je zásadní přerušení hlavní navigační cesty, přestože checkpoint zůstává dostupný na mapě. L02 je přístupnostní mezera pro konkrétní informace; bez asistivní technologie ji nevydávám za dokončené WCAG posouzení.

## Nálezy, priorita a nejmenší oprava

### L01 · P1 · Další krok zmizí právě před part testem

**Ověřený fakt:** `continueLevel` hledá pouze neprošlou odemčenou úroveň (`client/src/components/Roadmap.tsx:502`), nikoli odemčený checkpoint. Overview pak bez úrovně ukáže jen počet hotových úrovní (`:1164`) a vůbec nevykreslí tlačítko (`:1186`). Checkpoint přitom má vlastní `unlocked`/`isCurrent` stav (`:848`). Reprodukce: projít všechny úrovně první části, její part test nechat neprošlý, vrátit se na mapu.

**Dopad:** vracející se uživatel ztratí hlavní `Continue`; musí sám rozpoznat odlišný uzel v cestě. Stejný problém nastává před závěrečným testem tématu.

**Návrh:** overview vychází z `nextStep: Active | null` v pořadí úrovně → test části → další část. Použít existující unlock/availability/Premium pravidla, ne `find` nad holými metadaty. Text `Part 1 Test · Levels 1–5 completed`, CTA `Take the part test`. Teprve skutečné dokončení ukáže dokončený stav a sekundární procvičování.

**Validace:** první úroveň, checkpoint, další část, závěrečný checkpoint, skutečně dokončené téma, unavailable krok, Premium checkpoint a téma mimo plán. CTA se nesmí pokusit otevřít nic, co odmítá server. Zkontrolovat keyboard focus po návratu z výsledku.

### L02 · P1 · Důvod běžného zámku nelze zjistit klávesnicí

**Ověřený fakt:** zamčené topic karty jsou `disabled` a radio navigace je přeskakuje (`client/src/components/learn/SectionRail.tsx:104`, `client/src/components/ui/RadioCards.tsx:98`). U zamčené úrovně/checkpointu je konkrétní důvod v Tooltip nad wrapperem bez focusu, vlastní button je nativně disabled (`client/src/components/Roadmap.tsx:1425`, `:1435`, `:1528`, `:1537`). Viditelný text uzlu je omezen na dva řádky (`:1477`). Souhrn pod mapou vysvětluje obecná pravidla, nikoli konkrétní důvod každého uzlu.

**Dopad:** uživatel klávesnice nebo dotyku může vidět zámek bez konkrétní dostupné odpovědi „co mám udělat teď“. Dlouhý název navíc může zůstat zkrácený.

**Návrh:** zámek zachovat, vedle railu/uzlu nabídnout dosažitelné informace se skutečným názvem a podmínkou, například `Pass the Part 1 test to open Level 6`. Preferovat jeden inline detail výběru nebo stávající tooltip/detail pattern; nepřidávat všechny zamčené uzly jako desítky nových tab stopů. Premium zůstává explicitně `Premium`; výklad prerequisite se s ním neslučuje. Dlouhé názvy musí být dostupné mimo hover.

**Validace:** pouze klávesnice, VoiceOver, dotyk, dlouhý název, locked/unavailable/not-in-plan/Premium. Focus nepřeskakuje na body, tooltip má vlastní dostupný trigger nebo je důvod přímo v textu.

### L03 · P2 · Volitelnost čtení se ukáže až pod celým článkem

**Ověřený fakt:** `LearnLesson` vykreslí nejprve Back, pak celý `LessonView`, teprve potom informaci `Reading is optional...` a `Start the questions` (`client/src/components/learn/LearnLesson.tsx:43`, `:50`, `:53`). Je to správně i při chybě lekce: otázky lze spustit, čtení není nutná podmínka.

**Dopad:** vracející se uživatel vstoupí do dlouhého článku bez zjevné možnosti přeskočit přímo k otázkám. Tvrzení o volitelnosti se dozví pozdě.

**Návrh:** krátký řádek `Optional reading · Questions record your progress` umístit hned pod úvod. Dát dosažitelný sekundární `Skip to questions` nad článek. Spodní `Start the questions` zůstane jediný filled primary; není potřeba plovoucí overlay, nový toolbar ani kopírovat celou hlavičku. Přidat `On this page` pouze pro opravdu dlouhé strukturované články, odvozené z existujících headingů.

**Validace:** dlouhá/krátká lekce, failed/delayed loading, narrow 360px, zvýšený text, tab pořadí a focus po přeskočení. Oznamovat stejný skutečný progress model jako dosud.

### L04 · P2 · Try again v placementu znamená začít od nuly

**Ověřený fakt:** chyba načtení i odeslání kola vede do stejné `error` fáze (`client/src/components/Roadmap.tsx:1721`, `:1758`). Error view předá `onRetry={() => void start()}` (`:1807`); `start` provede nový GET a vymaže review (`:1712`). Server může odmítnout opakované odeslání již přijatého kola (`api/quiz/roadmap.ts:894`), proto slepé automatické resubmit není bezpečné řešení.

**Dopad:** po chybě ve třetím/čtvrtém kole slibuje generické `Try again` menší operaci, než ve skutečnosti provede. Uživatel může přijít o očekávání pokračování.

**Návrh:** rozlišit počáteční fetch a neobnovitelný submit. Pro neobnovitelný stav sdělit `This placement could not continue. Start a new placement.` a tlačítko `Restart placement`. Bez změny API lze hned opravit pravdivost copy; skutečné bezpečné navázání vyžaduje separátní návrh idempotentního recovery a serverové kontrakty.

**Validace:** chyba prvního GET, offline před POST, POST přijatý serverem se ztracenou odpovědí, expired/replayed token. Zachovat ochranu proti dvojímu odeslání a nevydávat neověřený score za uložený.

### L05 · P2 · FDE Start/Continue vypadá jako akce, ale je pouhý text

**Ověřený fakt:** karta má obecný link `Guided path` / `Guided path outline` (`client/src/components/paths/PathShelf.tsx:43`), zatímco `Start` / `Continue` / `Resume` se vykreslí ve `span.lp-module__meta` (`:57`). Celá karta není link.

**Dopad:** v kontextu rozděleném na témata a guided path uživatel může kliknout na správně vypadající sloveso, které nic neudělá. U enrolled uživatele navíc obecný nadpis zatajuje konkrétní pokračování až do další obrazovky.

**Návrh:** zachovat stručný nadpis a obsah inventáře, ale nahradit akční metadata skutečným sekundárním/row linkem na existující path hub: `Open path`, `Continue path`, `Resume path`. Neprovádět skryté enrollment/paid operace pouhým vstupem. Když cesta není otevřena, `View outline`; jeden hlavní CTA sekce dál vlastní join nebo pokračování v tématu.

**Validace:** guest/free/Premium, nenastartovaná/active/paused/disabled path, keyboard focus, měření 44px hit area a screen reader name. Text odpovídá tomu, kam link opravdu vede.

### L06 · P2 · Pojmy topic/path/part a zastaralá recovery věta přidávají tření

**Ověřený fakt:** rail je `Choose a topic`, ale jeho souhrn říká `{locked} of {total} paths still locked` (`client/src/i18n/translations.ts:805`, `:855`), zatímco skutečné guided paths mají vedle vlastní shelf (`paths/PathShelf.tsx:144`). `roadmap.notInPlanHint` odkazuje na změnu tracku na `Roadmap page` (`translations.ts:846`), přitom aktuální join flow směruje `Choose your plan` na `/profile#learning-plan` (`learn/SectionSwitcher.tsx:33`, `:213`).

**Dopad:** začátečník musí rozlišovat dvě různé věci pod názvem path; člověk mimo plán dostává zastaralou navigační instrukci.

**Návrh:** zavést slovník bez nového UI systému: sekce = Web/Software/FDE, topic = JavaScript, level = konkrétní krok, part test = checkpoint, guided path = FDE program. Souhrn `3 of 8 topics locked`; copy pro not-in-plan vede na existující `Choose your plan` a říká `Change your learning plan in Profile`. Počty dál z registrů; angličtina zůstává jediným jazykem aplikace.

**Validace:** inventář všech `roadmap.*`/`paths.*` vět v kontextu, deep links a návrat na mapu. Neprovádět globální search/replace technického slova path ve zdrojácích.

## Responzivita a přístupnost

Staticky: mobilní switcher už má samostatný stacked layout pod 640px, rail přepočítává sloupce a mapa pod 480px přechází na tři uzly (`Roadmap.css:516`, `learn/SectionRail.tsx:47`, `Roadmap.tsx:831`). To jsou existující silné stránky. Plná dlouhá mapa se skládá ze všech úrovní (`Roadmap.tsx:289`, `:828`); ověřit na skutečně nejdelším tématu, že titulky, serpentinové vizuální pořadí a DOM pořadí zůstávají srozumitelné. Nepovažuji samotnou délku mapy automaticky za chybu a nenavrhuji obnovovat skrytý part selector bez výzkumu.

Rizika vyžadující runtime ověření: L02, čitelnost dlouhých nadpisů, pořadí focusu po přechodu reading → questions → coding, 200/400% zoom a VoiceOver. Existující tests nejsou důkaz, že jsem nyní každou buňku ručně prošel.

## Pořadí implementace

1. L01: resolver dalšího kroku + cílený regresní test pro checkpoint; znovupoužít otevření i access guard.
2. L06 a L04: přesná anglická copy, důvody a navigace ve stávajících slovnících/error komponentách.
3. L02: jeden dosažitelný detail zámku; ověřit s klávesnicí a VoiceOver před rozšířením patternu.
4. L03: přesun informace o volitelnosti a sekundární skip; zachovat jeden primary.
5. L05: změnit metadata, která vypadají jako tlačítko, na skutečný odkaz; zachovat enrollment/Premium hranice.

## Validační matice

| Oblast | Scénáře | Stav tohoto auditu |
| --- | --- | --- |
| Kód/flow | všechny tři sekce, Big O reader, otázky, výsledek, placement, FDE vstup/workspace | Staticky přečteno; šest výše uvedených nálezů |
| Widths | 360, 390, 430, 768, 1024, 1280, 1440 | Všech 7 šířek: HTML 2/6 před checkpointem, bez page overflow; nejde o sweep všech stavů |
| Vzhled | light, dark, reduced motion, dlouhý obsah, zoom 200/400% | Statická kontrola existujících pravidel; plná vizuální validace neprovedena |
| Stav mapy | loading, partial/error, no levels, checkpoint, completed, Premium, not-in-plan | Runtime: HTML 2/6, overview 0 actions, Part 1 Test enabled ve všech 7 šířkách; ostatní větve staticky |
| Session | guest, signed in, expired/sign-in changed | Kódové větve zkontrolovány; žádný zápis do produkčních dat |
| Recovery | offline, ztracený POST, expired token, failed apply receipt | Statická kontrola; žádné fault-injection testování serveru |
| Accessibility | focus návrat, radio arrows, zámky, status, non-color, touch targets | Existující implementace přečtena; VoiceOver neproveden |
| FDE | closed outline, active, paused, error, local draft recovery, Reset | Runtime closed outline + skutečný inventář; active/paused/workspace staticky, bez reálného enrollmentu |

Kontroly při implementaci: `npm run check:design`, relevantní `client/tests/learn-*`, `npm run test:browser -- tests/browser/learn-sections.spec.ts tests/browser/learning-release.spec.ts`, responsive sweep a `git diff --check`. Merge až podle pravidel repozitáře; tento audit sám není release acceptance.

## Provedené kontroly a původ vizuálů

- `npm run check:design`: PASS, 13 contract fixtures, 26 existujících allowlisted výjimek.
- Built preview na `http://127.0.0.1:4173`, headless Google Chrome; struktura a path catalog z `scripts/responsive-fixtures.ts`, lekce z `lib/learn-lessons/index.ts:publicLesson`. Fixtures mění pouze síťová data lokálního prohlížeče a guest local storage, ne produkční záznamy.
- L01 runtime: `/learn/web-developer?topic=html`, prošlé úrovně 1 a 2, žádný checkpoint. Všech sedm šířek ukazuje `2 / 6 levels`, overview má nula button/link akcí, Part 1 Test je enabled. Page overflow nezjištěn v těchto konkrétních buňkách.
- Runtime `/learn/big-o?lesson=1`: skutečný článek `Counting work, not seconds`; při vstupu je `Start the questions` přibližně na y = 3 492 CSS px (viewport 1440 × 1000).
- Runtime `/learn/forward-deployed-engineer`: guest, cesta vypnutá, skutečný closed outline a inventář. Návrh active/Continue varianty v HTML je rekonstrukce statické větve, nikoli screenshot aktivního účtu.
- PNG screenshoty aktuálního klienta jsou vloženy jako data URI přímo v `learn.html`; žádný odkaz na lokální obrázek či externí font. HTML/CSS schémata „Po“ jsou deterministické návrhy, aplikace jimi změněna nebyla.
- Screenshoty v HTML jsou doklady konkrétních stavů; nejsou tvrzením o kompletním light/dark, keyboard, zoom ani server fault sweepu.

### Kontrola výsledného HTML reportu

- Všech 7 šířek 360, 390, 430, 768, 1024, 1280 a 1440: bez page overflow; všech šest párů před/po přítomno; všechny vložené obrázky načtené.
- Vizuálně zkontrolované renderované páry: L01 desktop, L03 mobile. Nadpisy, tlačítka a kód se vejdou, porovnání se na mobilu skládá pod sebe.
- Axe kontrola samotného reportu při 390px: 0 violations po opravě heading order a focusovatelných, jednoznačně pojmenovaných scroll tabulek. Toto není axe kontrola celé aplikace.
- `git diff --check` pro oba soubory: PASS.
