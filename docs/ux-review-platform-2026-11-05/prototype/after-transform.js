/* Review-only DOM concepts. Injected after the current application renders.
   This file is not imported by the product. It does not submit, grade or save. */
window.applyPlatformReview = function (scene) {
  const $ = (s, root = document) => root.querySelector(s);
  const all = (s, root = document) => [...root.querySelectorAll(s)];
  const node = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
  document.body.dataset.reviewConcept = scene;
  const style = node('style', '');
  style.textContent = `
    body[data-review-concept] { --ss-width-task: 880px; }
    [data-review-concept] .ss-route { max-width: min(1200px, 100%) !important; }
    [data-review-concept] main h1 { font-size: 29px !important; line-height: 1.22 !important; }
    [data-review-concept]:not([data-review-concept='coding-home']) main h2:not(.ss-kicker) { font-size: 20px; }
    [data-review-concept] main p { line-height: 1.55; }
    .review-crumbs { display:flex; align-items:center; flex-wrap:wrap; gap:0 5px; margin:0 0 12px; color:var(--color-text-secondary); font-size:13px; line-height:1.4; }
    .review-crumbs a { display:inline-flex; align-items:center; min-height:44px; color:inherit; text-decoration:none; }
    .review-crumbs a:hover { text-decoration:underline; }
    .review-crumbs [aria-current] { color:var(--color-text-primary); font-weight:600; overflow-wrap:anywhere; }
    .review-focus .ss-header, .review-focus .ss-brand-footer { display:none !important; }
    .review-focus #main-content { padding:16px 24px !important; }
    .review-focus .ss-app-root { padding-top:0 !important; }
    .review-focus .ss-question { max-width:880px; }
    .review-focus .ss-question-header__title { font-size:20px !important; }
    .review-focus .ss-question__panel { padding:20px 24px; gap:12px; }
    .review-focus .ss-question__block { min-height:128px; max-height:40vh; }
    .review-focus .ss-question__block[data-stable='false'] { min-height:0; }
    .review-focus .ss-question__panel pre { margin-block:12px; }
    [data-review-concept] .cd-next { border:1px solid color-mix(in srgb,var(--brand-accent) 35%,var(--ss-card-line)); border-left:3px solid var(--brand-accent); background:color-mix(in srgb,var(--brand-accent) 13%,var(--color-background-surface)); }
    [data-review-concept] .cd-home-head h1 { font-size:29px !important; }
    .review-formats { display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--ss-card-line); flex-wrap:wrap; margin-bottom:16px; }
    .review-formats a { color:var(--color-text-secondary); padding:0 16px; min-height:44px; display:flex; align-items:center; text-decoration:none; font-size:14px; }
    .review-formats a[aria-current] { color:var(--brand-accent); border-bottom:2px solid var(--brand-accent); font-weight:600; }
    .review-discovery { display:grid; grid-template-columns:240px minmax(0,1fr); gap:24px; }
    .review-format-menu { display:flex; flex-direction:column; align-items:stretch; gap:4px; }
    .review-format-menu a { min-height:44px; display:flex; align-items:center; color:var(--color-text-secondary); padding:8px 12px; text-decoration:none; border-radius:var(--radius-inner); }
    .review-format-menu a[aria-current] { color:var(--brand-accent); background:var(--brand-accent-soft); font-weight:600; }
    .review-discovery .cd-projects { display:block; }
    .review-discovery .cd-projects__intro .cd-lead { margin:6px 0 12px; }
    .review-discovery .cd-projects__rule { margin:8px 0 16px; max-width:none; }
    .review-discovery .cd-project { padding:14px 8px; }
    .review-discovery .cd-project-list { margin-top:16px; }
    .review-techniques { border-top:1px solid var(--ss-card-line); padding-top:16px; }
    .review-techniques summary { min-height:44px; cursor:pointer; font-weight:600; }
    .review-workspace .cd-workbench__grid { display:grid !important; grid-template-columns:minmax(0,58%) minmax(0,42%) !important; grid-template-rows:minmax(0,1fr) !important; height:calc(100dvh - 64px); gap:0 !important; }
    .review-workspace.review-stages .cd-workbench__grid { height:calc(100dvh - 120px); }
    .review-workspace .cd-pane--editor { grid-column:1 !important; grid-row:1 !important; overflow:hidden !important; }
    .review-workspace .cd-pane--output { grid-column:2 !important; grid-row:1 !important; padding:0 !important; border-left:1px solid var(--ss-card-line) !important; contain:size; }
    .review-workspace .cd-pane--output > .cd-tabs { padding-inline:12px; flex:none; flex-wrap:nowrap; overflow-x:auto; min-height:52px; }
    .review-workspace .cd-tabs > button { flex:none; padding-inline:10px; font-size:14px; }
    .review-workspace .cd-pane--output > .cd-output-scroll { padding:20px; }
    .review-workspace .cd-splitter { display:none !important; }
    .review-workspace .cd-editor-bar { min-height:52px; justify-content:flex-start; flex-wrap:wrap; gap:0; }
    .review-workspace .cd-editor-bar .review-crumbs { font-family:var(--cd-mono); margin:0 auto 0 0; gap:3px; font-size:12px; }
    .review-workspace .cd-editor-bar .review-crumbs a { min-height:44px; }
    .review-workspace .cd-editor-bar > button { flex:none; width:36px; min-width:36px; height:36px; min-height:36px; padding:6px; background:none; border:0; color:var(--color-text-secondary); }
    .review-workspace .review-utility svg { width:18px; height:18px; }
    .review-workspace .cd-editor-slot { flex:1 1 0 !important; min-height:0; }
    .review-workspace .cd-editor { flex:1 1 0 !important; min-height:0 !important; }
    .review-workspace .cm-editor { height:100%; min-height:0 !important; font-size:14px; }
    .review-workspace .cd-editor-actions { flex:none; padding:12px 16px !important; }
    .review-workspace .cd-complexity { border:0; padding-top:12px !important; margin-top:8px; font-size:13px; }
    .review-workspace .cd-complexity h2, .review-workspace .cd-complexity h3 { display:inline; font-size:13px; }
    .review-workspace .cd-brief-examples h2 { font-size:14px !important; }
    .review-workspace .cd-brief-examples { margin-bottom:0; }
    .review-workspace .cd-complexity { margin-top:0; }
    .review-workspace .cd-brief__title { font-size:22px !important; }
    .review-workspace .cd-stage-nav { margin:8px 0 0; gap:8px; font-size:13px; }
    .review-workspace .cd-page { gap:0; }
    .review-workspace .cd-output-scroll > .cd-panel { overflow-y:visible; min-height:0; }
    .review-workspace .cd-output-scroll { overscroll-behavior:contain; }
    .review-workspace .cd-brief__head { margin-bottom:12px; }
    [data-review-concept='learn'] .rm-section-body { display:grid; grid-template-columns:220px minmax(0,1fr); column-gap:24px; align-items:start; }
    [data-review-concept='learn'] .review-learn-content { grid-column:2; grid-row:1; min-width:0; display:flex; flex-direction:column; gap:16px; }
    [data-review-concept='learn'] .review-learn-content > * { min-width:0; }
    [data-review-concept='learn'] .rm-section-body > .rm-topic-rail { grid-column:1; grid-row:1; }
    [data-review-concept='learn'] .rm-topic-rail { grid-column:1; grid-row:1 / span 8; display:grid; grid-template-columns:1fr; gap:6px; margin:0; }
    [data-review-concept='learn'] .rm-section-switcher { margin-bottom:20px; }
    [data-review-concept='learn'] .rm-journey-heading { display:none; }
    [data-review-concept='learn'] .rm-section-body > .rm-section-header { grid-column:1 / -1; }
    [data-review-concept='learn'] .rm-part-nav { display:none; }
    [data-review-concept='learn'] .rm-overview-card { margin-top:0; }
    [data-review-concept='quiz-setup'] .quiz-setup { max-width:none; }
    [data-review-concept='quiz-setup'] .quiz-setup__panel { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr); gap:0 32px; }
    [data-review-concept='quiz-setup'] .quiz-setup__topics { grid-row:1 / span 3; border-bottom:0; padding-top:20px; }
    [data-review-concept='quiz-setup'] .quiz-setup__settings { grid-column:2; }
    [data-review-concept='quiz-setup'] .quiz-setup__start { grid-column:1 / -1; border-top:1px solid var(--ss-card-line); margin-top:16px; }
    [data-review-concept='quiz-setup'] .quiz-setup__guest { grid-column:2; }
    [data-review-concept='quiz-results'] .quiz-results { max-width:var(--ss-width-task); margin:0 auto; }
    [data-review-concept='quiz-results'] .quiz-results__summary > * { align-self:flex-start !important; }
    [data-review-concept='quiz-results'] .quiz-results__summary { align-items:flex-start; text-align:left; padding:20px 24px; }
    [data-review-concept='quiz-results'] .quiz-results__summary h1 { font-size:32px !important; }
    [data-review-concept='quiz-results'] .quiz-review-grid { grid-template-columns:1fr; gap:12px; }
    [data-review-concept='daily'] .ss-daily { max-width:880px; margin:auto; }
    [data-review-concept='daily'] .ss-daily > header { margin-bottom:16px; }
    [data-review-concept='daily'] .ss-daily h1 { font-size:24px !important; }
    [data-review-concept='daily'] .ss-info-lead { font-size:14px; }
    .review-today-columns { display:grid; grid-template-columns:1.25fr 1fr; align-items:start; gap:24px; }
    .review-today-columns > .today-section { margin-top:0; }
    [data-review-concept='today'] .today-card { border:1px solid var(--ss-card-line); }
    [data-review-concept='profile'] .de-profile-column .ss-panel { box-shadow:none; border:1px solid var(--ss-card-line); border-radius:16px; }
    [data-review-concept='profile'] .de-profile-column .ss-section-label { margin-bottom:12px; }
    [data-review-concept='fde-module'] .lp-page { display:grid; grid-template-columns:320px minmax(0,1fr); column-gap:32px; align-items:start; }
    [data-review-concept='fde-module'] .review-crumbs { grid-column:1 / -1; }
    [data-review-concept='fde-module'] .lp-head { grid-column:1; gap:12px; }
    [data-review-concept='fde-module'] .lp-section { grid-column:2; grid-row:2; }
    [data-review-concept='fde-module'] .lp-head h1 { font-size:26px !important; }
    [data-review-concept='fde-module'] .lp-lead { font-size:14px; }
    .review-objectives { margin-top:8px; color:var(--color-text-secondary); font-size:14px; }
    .review-objectives summary { min-height:44px; cursor:pointer; color:var(--color-text-primary); font-weight:600; }
    [data-review-concept='premium'] .ss-info-page { max-width:none; }
    [data-review-concept='premium'] main h1 { max-width:28ch; }
    [data-review-concept='leaderboard'] main h1 { margin-bottom:8px; }
    @media(max-width:900px) {
      .review-discovery, .review-today-columns, [data-review-concept='fde-module'] .lp-page { grid-template-columns:1fr; }
      .review-format-menu { flex-direction:row; flex-wrap:wrap; }
      [data-review-concept='fde-module'] .lp-head, [data-review-concept='fde-module'] .lp-section { grid-column:1; grid-row:auto; }
      [data-review-concept='learn'] .rm-section-body { display:block; }
      [data-review-concept='learn'] .rm-topic-rail { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); margin-bottom:16px; }
      [data-review-concept='quiz-setup'] .quiz-setup__panel { display:flex; gap:0; }
      [data-review-concept='quiz-setup'] .quiz-setup__topics { border-bottom:1px solid var(--ss-card-line); }
      .review-focus #main-content { padding:12px 16px !important; }
      .review-focus .ss-question__panel { padding:16px; }
      .review-workspace .cd-workbench__grid, .review-workspace.review-stages .cd-workbench__grid { display:flex !important; flex-direction:column; height:auto; }
      .review-workspace .cd-pane--output { order:0; min-height:300px; max-height:48dvh; border-left:0 !important; }
      .review-workspace .cd-pane--editor { order:1; min-height:480px; border-top:1px solid var(--ss-card-line) !important; }
      .review-workspace .cd-editor-slot { min-height:350px; }
      .review-workspace .cd-editor-bar { padding:4px 8px; }
      .review-workspace .cd-editor-bar .review-crumbs { flex-basis:100%; }
      .review-workspace .cm-editor { min-height:300px !important; }
      .review-workspace .cd-editor-bar > button { min-width:44px; min-height:44px; }
      .review-workspace .cd-stage-nav { flex-wrap:wrap; }
    }
    @media(prefers-reduced-motion:reduce) { [data-review-concept] * { animation:none !important; transition:none !important; } }
  `;
  document.head.append(style);
  function crumbs(items, parent, first = true) {
    const nav = node('nav', 'review-crumbs'); nav.setAttribute('aria-label', 'Breadcrumb');
    items.forEach(([label, href], i) => {
      if (i) { const sep = node('span', '', '/'); sep.setAttribute('aria-hidden', 'true'); nav.append(sep); }
      const e = node(href ? 'a' : 'span', '', label);
      if (href) e.href = href; else e.setAttribute('aria-current', 'page'); nav.append(e);
    });
    if (first) parent.prepend(nav); else parent.append(nav);
    return nav;
  }
  function focus() { document.body.classList.add('review-focus'); const root=$('.ss-app-root'); if(root)root.dataset.chrome='false'; }
  const route = $('.ss-route');
  const labels = {
    learn:[['Learn','/learn'],['Web Developer',null]], 'quiz-setup':[['Quiz',null]],
    'quiz-results':[['Quiz','/quiz'],['Results',null]], today:[['Today',null]],
    profile:[['Profile',null]], 'fde-module':[['Learn','/learn'],['Forward Deployed Engineer','/learn/forward-deployed-engineer/path'],['Customer discovery',null]],
    'coding-track':[['Coding','/coding'],['JavaScript',null]], leaderboard:[['Leaderboard',null]], premium:[['Premium',null]],
  };
  if (labels[scene] && route) crumbs(labels[scene], route.firstElementChild || route);
  if (scene === 'workbench' || scene === 'workbench-results' || scene === 'evolving') {
    focus(); document.body.classList.add('review-workspace');
    const page=$('.cd-page'), work=$('.cd-workbench'), editor=$('.cd-pane--editor'), output=$('.cd-pane--output');
    if (!page || !work || !editor || !output) throw new Error('Workbench must be rendered before applying the review concept.');
    const stage=$('.cd-stage-nav'); if(stage){document.body.classList.add('review-stages');page.append(stage);}
    all(':scope > .cd-actions:not(.cd-stage-nav), :scope > .ss-premium-note',page).forEach(e=>e.remove());
    const bar=$('.cd-editor-bar',editor); $('.cd-editor-bar__label',bar)?.remove();
    const file=scene==='evolving'?'linkShortener1.js':'digitSum.js';
    crumbs([['coding','/coding'],[scene==='evolving'?'fullstack':'javascript',scene==='evolving'?'/coding/fullstack':'/coding/javascript'],[file,null]],bar);
    const actions=$('.cd-editor-actions',editor);
    if(actions) all('button',actions).forEach(btn=>{
      const label=(btn.getAttribute('aria-label')||btn.textContent||'').trim();
      if (/^Run$|^Hint$|^Submit$/.test(label)) return;
      if(/Solution|Give up/.test(label)){btn.remove();return;}
      btn.classList.add('review-utility'); bar.append(btn);
    });
    const utility=(label,shape)=>{const btn=node('button','review-utility');btn.type='button';btn.title=label;btn.setAttribute('aria-label',label);btn.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">'+shape+'</svg>';bar.append(btn);};
    if(!all('button',bar).some(e=>/Skip/.test(e.getAttribute('aria-label')||e.textContent))) utility('Skip','<path d="m5 5 10 7L5 19zM19 5v14"/>');
    if(!all('button',bar).some(e=>/save|star/i.test(e.getAttribute('aria-label')||''))) utility('Star challenge','<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9z"/>');
    if(innerWidth<900){
      all('button',bar).filter(b=>/More actions/i.test(b.getAttribute('aria-label')||b.textContent)).forEach(b=>b.remove());
      if(!all('button',bar).some(b=>/Report|Flag/i.test(b.getAttribute('aria-label')||'')))utility('Flag challenge','<path d="M5 21V3c5-3 9 3 14 0v10c-5 3-9-3-14 0"/>');
      const commands=$('.cd-actions--commands',editor);
      if(commands&&!all('button',commands).some(b=>/Hint/.test(b.getAttribute('aria-label')||b.textContent))){const hint=node('button','astryx-button','Hint');hint.type='button';hint.setAttribute('aria-disabled','true');hint.title='Sign in to use hints';hint.style.cssText='background:transparent;border:0;opacity:.55;min-height:44px;padding:8px 16px';commands.children[0]?.after(hint);}
      const grid=$('.cd-workbench__grid');grid.prepend(bar);bar.style.order='-1';
    }
    const buttons=all(':scope > button',bar);const order=b=>{const t=b.getAttribute('aria-label')||b.textContent;return /Format/i.test(t)?0:/Reset/i.test(t)?1:/Skip/i.test(t)?2:/Star|Save/i.test(t)?3:4;};buttons.sort((a,b)=>order(a)-order(b)).forEach(b=>bar.append(b));
    const feedback=$('.cd-feedback');
    if(feedback){
      const tabs=$('.cd-tabs',output), panels=$('.cd-output-scroll',output);
      const referenceTabs=all('[role=tab]',tabs);
      const feedbackTabs=all('[role=tab]',feedback);
      const description=referenceTabs.find(t=>/Description/.test(t.textContent));
      const sequence=[description,...feedbackTabs,...referenceTabs.filter(t=>t!==description)];
      sequence.forEach(t=>{if(t)tabs.append(t);});
      all('[role=tabpanel]',feedback).forEach(p=>panels.append(p));feedback.remove();
      const selected=scene==='workbench-results'?'Results':'Description';
      all('[role=tab]',tabs).forEach(t=>{const yes=t.textContent.trim()===selected;t.setAttribute('aria-selected',String(yes));t.tabIndex=yes?0:-1;});
      all('[role=tabpanel]',panels).forEach(p=>{const t=sequence.find(t=>t?.id===p.getAttribute('aria-labelledby'));p.hidden=t?.textContent.trim()!==selected;});
    }
    const brief=$('.cd-panel .cd-brief__body')||$('.cd-panel .cd-brief'); const complexity=$('.cd-complexity');if(brief&&complexity)brief.append(complexity);
  }
  if(scene==='coding-home'||scene==='coding-discovery'){
    const page=$('.cd-discovery');
    if(scene==='coding-discovery'&&page){
      const galleries=all(':scope > .cd-projects',page); const selected=galleries[1]||galleries[0];
      const wrap=node('section','review-discovery'), menu=node('nav','review-format-menu');menu.setAttribute('aria-label','Challenge formats');
      [['Evolving challenges','#evolving'],['Debugging paths','#debugging'],['FullStack projects','/coding/fullstack']].forEach(([name,href],i)=>{const a=node('a','',name);a.href=href;if(!i)a.setAttribute('aria-current','page');menu.append(a)});
      wrap.append(menu);if(selected)wrap.append(selected);
      const first=page.querySelector('.cd-run');if(first)first.after(wrap);else page.append(wrap);
      galleries.filter(e=>e!==selected).forEach(e=>e.remove());$('.cd-fullstack-feature',page)?.remove();
      const techniques=$('#cd-techniques')?.closest('section');if(techniques){const details=node('details','review-techniques'),summary=node('summary','','Browse by technique');details.append(summary);details.append(techniques);page.append(details);}
    }
  }
  if(scene==='today'){
    all('.today-item__link').forEach(link=>{link.className='today-card ss-panel';const body=$('.today-item__body',link);if(body)body.className='today-card__body';const title=$('.today-item__title',link);if(title)title.className='today-card__meta';const reason=$('.today-item__reason',link);if(reason)reason.className='today-card__reason';const action=$('.today-item__action',link);if(action){action.className='today-card__action';action.firstChild.textContent='Continue ';}});
    const sections=all('.today-section');if(sections.length>1){const wrap=node('div','review-today-columns');sections[0].before(wrap);sections.forEach(s=>wrap.append(s));}
  }
  if(scene==='profile'){
    const left=$('[data-column=learning] > div'), right=$('[data-column=account]');
    const account=all('.ss-panel',right).find(e=>/Sign out on all devices/.test(e.textContent));
    const track=left&&[...left.children].find(e=>/Track and Sections/i.test(e.textContent));
    if(account&&track) track.after(account);
  }
  if(scene==='learn'){const body=$('.rm-section-body'), rail=$('.rm-topic-rail'); if(body&&rail){const content=node('div','review-learn-content'); [...body.children].filter(e=>e!==rail).forEach(e=>content.append(e));body.append(content);}}
  if(scene==='quiz-active'||scene==='challenge-active')focus();
  if(scene==='daily'){
    focus(); const header=$('.ss-daily > header');if(header)crumbs([['Today','/today'],['Daily question',null]],header);
  }
  if(scene==='fde-module'){
    const head=$('.lp-head__text')||$('.lp-head'), list=head&&$('ul',head);
    if(list){const details=node('details','review-objectives'),summary=node('summary','','Learning objectives · '+list.children.length);details.append(summary);list.before(details);details.append(list);}
  }
};
