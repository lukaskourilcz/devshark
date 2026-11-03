# Quiz: senior UX audit, 3. listopadu 2026

**Stav: návrh, žádná změna produkčního Quiz UI.** Podkladem je skutečný kód `/quiz` na větvi `fix/coding-description-workbench`. Report doplňuje [centrální inventář UX](../design/product-ux-audit.md); nenahrazuje jej. Interaktivní vizuální porovnání je v [quiz.html](quiz.html). Všechen navrhovaný produktový text zůstává anglicky.

## Rozsah a cíl uživatele

Začínající i vracející se vývojář chce vybrat smysluplný rozsah procvičování, bezpečně dokončit kvíz a porozumět chybám. Hodnoceny jsou standardní kvíz, dnešní challenge, personalizované opakování, obnovení rozehrané relace, odeslání a výsledky. Samostatná `/challenge` a `/daily` jsou odlišné produkty uvnitř devShark a nejsou zde vydávány za totéž.

Cesta: `App.tsx:883` → `Quiz.tsx`; standardní a review sada jdou přes `api/quiz/questions.ts:176,338`, denní sada přes `client/src/lib/supabase.ts:83` → `api/quiz/daily.ts`; vyhodnocení přes `Quiz.tsx:645` → `api/quiz/submit.ts`, uložení podepsaného výsledku přes `client/src/lib/supabase.ts:59` → `api/user/[op].ts`. Návrhy nemění serverové hodnocení, tajnost správné odpovědi před odesláním, XP, Premium pravidla, autoritu účtu ani počet handlerů.

**Metoda:** audit kódu, existujících testů, textového slovníku a designových pravidel. Vizuály v HTML jsou deterministické HTML/CSS rekonstrukce vybraných částí skutečného UI a návrhy. Nejsou to screenshoty ani důkaz nasazení. Stav vykonaných browser kontrol je uveden níže; neprovedené kontroly nejsou označené jako úspěšné.

## Co zachovat

- Jednoduchý setup: jedna karta, `PageHeader`, témata, délka, obtížnost a jediný hlavní `Start quiz` (`Quiz.tsx:900–975`). Uložené volby jsou užitečné pro návraty (`Quiz.tsx:374–381`).
- Společné `QuestionShell`, `QuestionHeader`, `AnswerOptionList`, `QuestionActions`; čísla odpovědí, klávesnice a stabilní geometrie (`Quiz.tsx:1236–1328`). Nový designový systém není potřeba.
- Čitelná tlačítka 44px, viditelné názvy a tooltipy ikon, textová správnost/nesprávnost vedle symbolu (`question/QuestionHeader.tsx:59`, `Quiz.tsx:1093–1101`).
- Ochranu před ztrátou odpovědí, obnovení session, uzamčení po odeslání, oddělený stav vypršení a opakování se stejným nastavením (`Quiz.tsx:312–356,643,734–743,865–884`).
- Rozlišení zneplatněné otázky od špatné odpovědi (`Quiz.tsx:1084–1086`) a přesun fokusu na výsledek (`Quiz.tsx:779–786`).

## Mapa opětovného použití

| Potřeba | Existující řešení | Použití |
|---|---|---|
| Nadpis, hlavní akce | `ui/PageHeader`, `landing/LandingKit` → `SwimCta` | Zachovat v setupu i výsledku, jeden primární krok |
| Průběh a odpovědi | `question/QuestionHeader`, `QuestionShell`, `AnswerOptionList`, `QuestionHint` | Doplnit stav, ne duplikovat runner |
| Prázdno, chyba, oprávnění | `ui/StatePanel`, Astryx `Banner`, `QuestionActions` | Jedna příčina + jedna další akce |
| Témata | `ui/CategoryTag` → `TopicPill`, `lib/categories.ts` | Zachovat registry a `aria-pressed` |
| Dialogy a hlášení | `ReportDialog`, `BrandedConfirmDialog`, existující Astryx `AlertDialog` | Nenavrhovat nový modal nebo toast systém |
| Uložený výsledek | `pendingQuizReceipts`, `pendingQuizReplay`, `PendingQuizResults` | Zviditelnit aktuální stav stávajícího mechanismu |
| Návrat ke znalosti | `SaveSharkCard`, odkazy do Learn podle existujících map | Zachovat správný grading a entitlementy |

## Blockery

Nebyl prokázán blocker, který by bránil dokončení celého Quiz flow. Níže jsou konkrétní vady interakce a prioritní zlepšení; nejsou vydávána za naměřené konverzní ztráty.

## Důležité problémy workflow a hierarchie

### Q01 · P1 · Select all může vymazat skrytě vybraná témata

**Ověřený fakt:** `Quiz.tsx:592–596` sestavuje pool z právě zobrazených kategorií. Pokud nejsou všechny zvolené, vrací pouze `pool`, nikoli sjednocení s předchozí volbou. Rozbalení/sbalení používá samostatný stav (`Quiz.tsx:275–296,923–928`).

**Dopad:** uživatel vybere např. Security v rozbaleném seznamu, seznam sbalí a použije Select all. Dřívější skrytá volba může zmizet bez vysvětlení. Přesný výsledek závisí na admin konfiguraci a dosavadní volbě.

**Nejmenší oprava:** akce na viditelném poolu zachovává ostatní volby: přidání = sjednocení; odebrání = rozdíl. Text `Select visible topics` / `Deselect visible topics`; při sbalení zobrazit počet dalších vybraných témat. Alternativou je skutečné Select all nad celým dostupným seznamem, ale pak musí UI tento rozsah jednoznačně říct.

**Validace:** vybrat skryté téma, sbalit, částečně vybrat viditelná, použít obě hromadné akce; skrytá volba zůstane. Ověřit payload startu a uložené preference.

### Q02 · P1 · Návrat k přeskočeným otázkám je dostupný až na konci

**Ověřený fakt:** Next dovoluje přeskočit bez odpovědi (`Quiz.tsx:1306`); až poslední Submit ukáže počet a přesune index na první chybějící (`Quiz.tsx:1164–1179,1309–1313`). Ve vykresleném runneru není přímý přehled jednotlivých otázek (`Quiz.tsx:1236–1328`).

**Dopad:** u dlouhé sady musí uživatel procházet Previous/Next, aby našel konkrétní nevyplněnou nebo nejistou otázku. Pozice `Question 10 of 10` a progress podle počtu odpovědí nejsou stejná informace, ale aktuální UI tento rozdíl pojmenovává jen obecně `Quiz progress`.

**Návrh:** přidat klidný text `8 of 10 answered` a secondary `Review unanswered (2)`, který otevře přehled nebo přesune na první chybějící s fokusem. Zachovat volné procházení i jednu hlavní akci. Na poslední otázce při chybějících odpovědích použít odpovídající label namísto Submit, který ve skutečnosti neodesílá. Nezavádět povinné potvrzení po každé odpovědi.

**Validace:** přeskočit první i prostřední otázku, dosáhnout konce, klávesnicí najít chybějící a odeslat právě jednou. Pojmenovat stav ikonami/textem, nejen barvou; nepřevzít šipky radiogroupu.

### Q03 · P1 · Výsledek zdůrazňuje nový kvíz před porozuměním chybám

**Ověřený fakt:** primární je `New quiz`; `Review answers ↓` je secondary (`Quiz.tsx:1062–1074`). Všechny otázky se ihned vykreslí v dvousloupcovém seznamu bez filtru (`Quiz.tsx:1080–1142`, `Quiz.css:21–29`).

**Dopad:** při 50 otázkách se oprava dvou chyb ztrácí v dlouhém seznamu včetně správných odpovědí. Hypotézou je oslabení dalšího učení; velikost dopadu vyžaduje uživatelské ověření.

**Návrh:** pokud existují chyby, hlavní akce `Review 2 incorrect answers`; sekundární `New quiz`. Nad stávajícími review komponentami přidat `Incorrect (2)` / `All answers (10)` a defaultně ukázat chyby. Při 100 % zůstává hlavní New quiz; zneplatněné otázky uvést samostatně, nikoli mezi chybami. Zachovat Shark Cards i report na každé relevantní otázce. Neopakovat vysvětlení v nové souhrnné kartě i v detailu.

**Validace:** 0 %, smíšený výsledek, 100 %, 50 otázek, zneplatněné otázky a nulový počet hodnocených. Filtr mění pouze prezentaci serverového výsledku, ne skóre.

### Q04 · P1 · Stav uložení do účtu zmizí s toastem

**Ověřený fakt:** grading zobrazí výsledek před zápisem statistiky (`Quiz.tsx:665–671,700–724`). Chyba uložení nastaví toast; result toast mizí po 2500 ms (`Quiz.tsx:1145–1150`). Summary nemá trvalý stav synchronizace (`Quiz.tsx:1013–1061`). Retry fronta již existuje; není správné tvrdit, že se výsledek vůbec nezachovává (`PendingQuizResults.tsx:1–49`).

**Dopad:** uživatel, který nestihne oznámení, nerozliší ověřené vyhodnocení od úspěšného uložení do profilu, XP a streaku.

**Návrh:** jediný nenápadný stav ve výsledku: `Saving to your account…`, `Saved to your account`, `Waiting to sync. We’ll retry when you’re online.` nebo `Could not save this result.` podle skutečné fronty/odpovědi. Toast může potvrdit změnu, ale nenese jedinou informaci. Opakovat jen existující signed receipt, ne grading.

**Validace:** grading 200 + zápis 503, návrat online, opakované přehrání fronty, odmítnutý/expirující receipt, odhlášení nebo změna účtu uprostřed požadavku. Nikdy ukázat Saved bez potvrzení serveru.

### Q05 · P2 · Význam obtížnosti je schovaný v tooltipu

**Ověřený fakt:** význam Basics/Easy/Progressive/Advanced/Mixed je jen v Tooltip nad volbou (`Quiz.tsx:954–963`, `translations.ts:367–376`).

**Dopad:** novice nerozliší zejména Progressive a Mixed bez další interakce. Ovládání tooltipu na dotykové obrazovce je potřeba ověřit, nelze pouze z kódu označit za nefunkční.

**Návrh:** pod volbami jediná řádka popisující vybraný mód, např. `Progressive: difficulty 1 to 5, in order.` Tooltip nemusí stejný text opakovat. Nenabízet nepodložený odhad času.

**Validace:** 360px, dlouhé texty, touch + klávesnice, oznámení aktualizace bez přesunu fokusu a bez dvojího čtení.

### Q06 · P2 · Dnešní challenge a review ztrácejí identitu po startu

**Ověřený fakt:** setup má odkazy do dalších režimů (`Quiz.tsx:978–985`), ale aktivní header vždy používá `nav.quiz` (`Quiz.tsx:1250`); personalizovaný plán je viditelný až po review (`Quiz.tsx:1052–1058`).

**Dopad:** po přímém vstupu `/quiz?mode=daily` nebo `?mode=review` není v nadpisu potvrzeno, který režim právě běží. Riziko záměny pojmů Today’s challenge, samostatný Challenge a question of the day je hypotéza pro ověření napříč navigací.

**Návrh:** existující `QuestionHeader.run` dostane pravdivý název režimu: `Quiz`, `Today’s challenge`, `Review`. Pod odkazy na setupu lze stručně vysvětlit pouze rozdíl mezi režimy, pokud ho uživatelé netrefují. Nevytvářet další top-level obrazovku ani povinný mezikrok.

**Validace:** přímé URL, reload uložené daily/review, opakování po chybě, dokončená daily a dostupnost review jen pro přihlášené.

## Responzivita a přístupnost

### Q07 · P1 · Review answers přesune viewport, nikoli fokus

**Ověřený fakt:** `Quiz.tsx:1067–1070` volá pouze scrollIntoView; cílové `h2` není focusable (`Quiz.tsx:1077`).

**Dopad:** uživatel klávesnice vizuálně přeskočí dolů, ale příští Tab pokračuje z původní action row. Čtečka nemá potvrzen nový kontext. Není to tvrzení, že všechny přechody mají chybný fokus: výsledek i start již cíle mají.

**Nejmenší oprava:** ref a `tabIndex=-1` na review nadpisu; po změně filtru/aktivaci review přesunout fokus na nadpis přes `focus({preventScroll:true})` a teprve scrollovat s respektováním reduced motion. Zachovat logický návrat.

**Validace:** klávesnice a čtečka, reduced motion, filtr, 200/400 % zoom a přechod mezi odpovědí a report dialogem.

### Q08 · P2 · Během čekání není lokální cesta zpět

**Ověřený fakt:** loading renderuje pouze QuoteLoader (`Quiz.tsx:861–863`), loading současně vypíná chrome (`Quiz.tsx:302–306`). Abort controller existuje (`Quiz.tsx:390–401`), ale loading branch nenabízí uživatelské zrušení.

**Dopad:** pomalá odpověď může působit jako zablokovaná aplikace, přestože browser Back stále existuje. Délku skutečných timeoutů tento audit neměří.

**Návrh:** po delším čekání tichý `Back to quiz settings`, který abortuje request, a odpovídající status. Znovu použít StatePanel/QuestionActions; přerušený request nesmí později přepsat setup. U chybového panelu konzistentní h1 a fokus na stav, ne pouze Banner.

**Validace:** pomalý request, offline start, zrušení těsně před response, retry a změna režimu; bez souběžných startů a duplicitní session na obrazovce.

## Obsahové problémy

### Q09 · P2 · Host se o omezení přenosu dozví až na konci

**Ověřený fakt:** guest notice `register.deviceOnly` je až ve výsledku (`Quiz.tsx:1046–1049`), setup jej nemá (`Quiz.tsx:900–986`). Sign-in následně nenahraje guest balance do účtu (`Quiz.tsx:726–729`).

**Návrh:** pro hosta jediná věta před Start: `You’re practising on this device. Sign in before starting to save results to your account.` Sign in je klidná akce se stávajícím auth dialogem. Neopakovat ji v dalších třech bannerech ani nezablokovat guest start. Copy musí odpovídat skutečné implementaci přenosu dat, nikoli slibovat zpětné uložení.

**Validace:** host → přihlášení před startem, host → přihlášení po výsledku, auth loading/failure a narrow layout. Nesmí vzniknout dva primární CTA.

### Q10 · P2 · Session má hodinový limit, aktivní UI jej nevysvětluje

**Ověřený fakt:** expiresAt se ukládá a při obnovení kontroluje (`Quiz.tsx:323–328,351`); vysvětlení hodinového limitu je na chybové obrazovce po expiraci (`translations.ts:730–732`). Active header předává pouze progress, ne čas (`Quiz.tsx:1249–1254`).

**Návrh:** v režimech s platným expiresAt zobrazit klidný absolutní text `Submit before 16:30` v existujícím status slotu a jediné varování těsně před vypršením. Žádný odpočet po sekundách, zvuková urgence ani fiktivní pauza. Při návratu do tabu zkontrolovat datum; stale relaci ukončit s vysvětlením před dalším dlouhým vyplňováním.

**Validace:** tab spí přes expiraci, reload před/po expiraci, chybějící expiresAt u legacy uložené relace, lokální formát času; screen reader nedostává každosekundové hlášky.

## Pořadí implementace

1. `Quiz.tsx`: Q01 a Q07 jako malé izolované opravy; rozšířit existující `client/tests/quiz.test.tsx` o skutečné regresní scénáře.
2. `Quiz.tsx`, `translations.ts`: Q02, Q05, Q06; využít současné komponenty a přidat pouze nezbytný stav přehledu/filtru.
3. `Quiz.tsx`, `pendingQuizReceipts`/replay napojení: Q04. Nezavádět druhou frontu; testovat změnu účtu a idempotenci.
4. `Quiz.tsx`, `Quiz.css`: Q03, Q09, Q10, Q08; opět použít shared status sloty, StatePanel a dialogy. Nové vizuální komponenty vytvářet jen při skutečném opakování i na dalších routech.
5. Přenést potvrzené a schválené nálezy do `docs/design/product-ux-audit.md`; uzavírat je až s důkazem nasazeného chování.

## Validační matice

| Oblast | Požadovaný scénář | Stav v tomto auditu |
|---|---|---|
| Kód a flow | Setup → fetch → odpovědi → grading → signed receipt → review | Provedeno statické trasování |
| Standard/daily/review | Vstup i přímý URL, opakování po chybě, restored session | Kód a existující testy přečteny; runtime ověření uvedeno v doplňku níže |
| Stavové pokrytí | Loading, empty, offline, error, auth, Premium, disabled, success, expired, dlouhý obsah | Staticky zhodnoceno; žádné tvrzení o úplném runtime průchodu |
| Responzivita | 360, 390, 430, 768, 1024, 1280, 1440; light/dark | Plán pro produkční implementaci; rekonstrukce reportu je oddělená od aplikace |
| Přístupnost | Keyboard, focus, radio arrows, dialog restore, screen reader, zoom/reflow, contrast, reduced motion | Statické ověření s konkrétním fokusem Q07; screen reader neproveden |
| Data | Server scores, správné odpovědi utajené před gradingem, Premium text, XP a účet | Chráněné invarianty; report je nemění |
| Automatické kontroly | `check:design`, unit testy změněných částí, browser route axe, build, diff check | Tento dokument neoznačuje cizí běh CI za vlastní test |

## Jak číst priority

P1 = konkrétní riziko změny volby, ztráty kontextu nebo dokončení/porozumění výsledku; vyřešit před širším restylingem. P2 = zlepšení orientace, vysvětlitelnosti nebo odolnosti při pomalém/stale stavu. Priorita není naměřená finanční škoda. Uživatelsky ověřit zejména rychlost nalezení přeskočené odpovědi a schopnost po výsledku vybrat další smysluplný krok; počty a časy teprve změřit, nevymýšlet.
