/* Round-three concepts only. Never imported by the product. All changes are
 * in-memory DOM/CSS, on the same data as the immediately preceding capture. */
(() => {
  const one = selector => { const node = document.querySelector(selector); if (!node) throw new Error('Concept target missing: ' + selector); return node; };
  const make = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const style = text => { const n = make('style'); n.textContent = text; document.head.append(n); };
  const common = `
    .r3-note{color:var(--color-text-secondary);font-size:13px;line-height:1.5;margin:8px 0}
    .r3-tool{font:inherit;min-height:44px;border:1px solid var(--color-border);border-radius:var(--radius-element);padding:8px 12px;background:var(--ss-card-bg);color:var(--color-text-primary)}
    .r3-tool:focus-visible,.r3-pick>summary:focus-visible,.r3-jumps a:focus-visible{outline:2px solid var(--ss-focus);outline-offset:3px}
    .r3-pick{border:1px solid var(--color-border);border-radius:var(--radius-element);background:var(--ss-card-bg);margin:0 0 10px;min-width:0}
    .r3-pick>summary{list-style:none;min-height:44px;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-size:14px;font-weight:600}
    .r3-pick>summary::-webkit-details-marker{display:none}.r3-pick>summary::after{content:'⌄';font-weight:400}
    .r3-pick[open]>summary{border-bottom:1px solid var(--color-border)}
  `;
  function disclosure(node, text) {
    const box = make('details', undefined, 'r3-pick'), summary = make('summary', text);
    node.before(box); box.append(summary, node); return box;
  }
  window.applyRoundThree = (scene, data = {}) => {
    document.documentElement.dataset.reviewScene = scene;
    style(common);
    if (scene === 'daily') {
      style(`
        .ss-daily{gap:10px!important}.ss-daily>.ss-info-page__header{padding:0!important;gap:6px!important;margin-bottom:0!important}
        .ss-daily>.ss-info-page__header h1{font-size:24px!important;line-height:1.25!important}
        .ss-daily .ss-daily__context{font-size:14px!important;line-height:1.4!important}.ss-daily__context p{margin-bottom:5px!important}
        .ss-daily>.ss-info-page__header .ss-daily__practice{font-size:12px!important;line-height:1.45!important}
        .ss-daily .ss-question{gap:8px!important}.ss-daily .ss-question__panel{padding:12px 24px!important;gap:10px!important}
        .ss-daily .ss-question__body{gap:8px!important}.ss-daily .ss-question__block p{margin:0 0 8px!important}
        .ss-daily .ss-question__block pre{margin:8px 0 0!important;padding:10px 16px!important}
        .ss-daily .ss-answer-list{--ss-answer-row-min:44px;gap:4px!important}.ss-daily .ss-answer-option{min-height:44px!important;padding-block:7px!important}
        @media(max-width:559px){.ss-daily .ss-question__panel{padding:16px!important}.ss-daily>.ss-info-page__header h1{font-size:22px!important}}
      `);
    }
    if (scene === 'learn-mobile') {
      const section = one('.rm-section-switcher'), rail = one('.rm-topic-rail');
      const selectedSection = section.querySelector('[aria-checked="true"]')?.textContent?.replace(/\s+/g, ' ').replace(/\s*·\s*/g, ' · ').trim() || 'Web Developer · 0%';
      const selectedTopic = rail.querySelector('[aria-checked="true"]')?.textContent?.replace(/\s+/g, ' ').replace(/([^\d\s])(\d)/, '$1 · $2').trim() || 'HTML · 0 / 6 levels';
      disclosure(section, selectedSection); disclosure(rail, selectedTopic);
      style(`
        .r3-pick .rm-section-switcher{margin:0!important}.r3-pick .rm-topic-rail{margin:8px!important;width:calc(100% - 16px)!important}
        .r3-pick .rm-section-switcher__scroll{padding:4px!important}.rm-section-body{display:block!important}
        .rm-journey-heading{margin-bottom:12px!important}.rm-section-content{margin-top:18px!important}
        .rm-section-content>header{margin-top:0!important}.rm-overview-card{margin-top:14px!important}
      `);
    }
    if (scene === 'editor-mobile') {
      const bar = [...document.querySelectorAll('.cd-editor-bar')].find(n => n.getBoundingClientRect().height > 0);
      if (!bar) throw new Error('No visible editor breadcrumb bar');
      const grid = one('.cd-workbench__grid'); grid.prepend(bar); bar.classList.add('r3-mobile-path');
      style(`
        .cd-workbench__grid>.r3-mobile-path{order:-2!important;width:100%;min-width:0;position:sticky;top:0;z-index:4;background:var(--ss-card-bg);border-bottom:1px solid var(--color-border);border-radius:var(--radius-container) var(--radius-container) 0 0;flex-wrap:nowrap!important;padding:6px 10px!important;gap:4px!important}
        .r3-mobile-path .cd-editor-bar__path{min-width:0;flex:1!important;overflow:hidden!important;font-size:12px!important}
        .r3-mobile-path .cd-editor-bar__path ol{flex-wrap:wrap!important;gap:3px!important}.r3-mobile-path button{flex:none}
        .cd-pane--output{border-radius:0!important}
      `);
    }
    if (scene === 'projects') {
      for (const progress of document.querySelectorAll('.cd-project__progress p')) {
        for (const child of [...progress.children]) if (child.textContent.trim() === 'Premium') child.remove();
      }
      const rule = one('.cd-projects__rule');
      rule.replaceChildren(make('strong', 'Stages 1–3 are free. '), document.createTextNode('Premium opens the later stages.'));
    }
    if (scene === 'catalogue') {
      for (const item of document.querySelectorAll('.cd-row-item')) {
        const link = item.querySelector('a.cd-row'), title = item.querySelector('.cd-row__title')?.textContent;
        const id = link?.getAttribute('href')?.split('/').pop(), task = data.tasks?.find(t => t.id === id || t.title === title);
        if (!task) continue;
        const main = item.querySelector('.cd-row__main'), old = main.querySelector('.cd-row__meta');
        const meta = make('span', task.difficulty[0].toUpperCase() + task.difficulty.slice(1) + ' · ' + task.estimatedMinutes + ' min', 'cd-row__meta r3-task-meta');
        if (old) old.replaceWith(meta); else main.append(meta);
      }
      style(`.r3-task-meta{white-space:nowrap;font-size:12px!important}.cd-row__main{column-gap:8px!important}`);
    }
    if (scene === 'results') {
      const list = one('.cd-panel:not([hidden]) .cd-results'), rows = [...list.querySelectorAll('.cd-result')];
      const failed = rows.filter(n => n.classList.contains('cd-result--fail')), passed = rows.filter(n => n.classList.contains('cd-result--pass'));
      const wrap = make('div', undefined, 'r3-results'), top = make('div', undefined, 'r3-results-summary');
      top.append(make('strong', failed.length + ' failed', 'r3-fail-text'), make('span', passed.length + ' passed', 'r3-pass-text')); wrap.append(top);
      for (const [i, row] of failed.entries()) {
        const call = row.querySelector('.cd-result__call')?.textContent || '';
        const text = row.querySelector('.cd-result__expect')?.innerText || '';
        const pair = text.split(/\s*·\s*got\s*/), expected = pair[0].replace(/^\s*→\s*/, '').replace(/^expected\s*/i, '').trim(), actual = pair[1] ?? '';
        const d = make('details', undefined, 'r3-failure'); if (i === 0) d.open = true;
        const sum = make('summary'); sum.append(make('strong', 'Failed · Test ' + (rows.indexOf(row) + 1)), make('span', call)); d.append(sum);
        const body = make('div', undefined, 'r3-failure-body');
        for (const [label, value] of [['Input', call], ['Expected', expected], ['Received', actual]]) {
          let formatted = value; if (label === 'Expected') { try { formatted = JSON.stringify(JSON.parse(value), null, 2); } catch {} }
          const block = make('div', undefined, 'r3-value'); block.append(make('div', label, 'r3-value-label'), make('pre', formatted)); body.append(block);
        }
        d.append(body); wrap.append(d);
      }
      const passGroup = make('details', undefined, 'r3-passed'); passGroup.append(make('summary', 'Passed tests (' + passed.length + ')'));
      const ul = make('ul', undefined, 'cd-results'); passed.forEach(n => ul.append(n)); passGroup.append(ul); wrap.append(passGroup); list.replaceWith(wrap);
      one('[role="tab"][data-tab="results"] .cd-tab__badge').remove();
      style(`
        .r3-results-summary{display:flex;align-items:center;gap:16px;padding:0 0 12px;font-size:13px}.r3-fail-text{color:color-mix(in srgb,var(--ss-error) 78%,var(--ss-ink))}.r3-pass-text{color:var(--ss-success)}
        .r3-failure{border-top:1px solid var(--color-border)}.r3-failure>summary{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer;font-size:12px;list-style:none}
        .r3-failure>summary strong{white-space:nowrap;color:color-mix(in srgb,var(--ss-error) 78%,var(--ss-ink))}.r3-failure>summary span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;font-family:var(--font-family-mono,monospace)}
        .r3-failure>summary::after{content:'⌄';font-size:14px}.r3-failure-body{display:grid;gap:9px;padding-bottom:14px}.r3-value-label{font-size:11px;font-weight:700;color:var(--color-text-secondary);margin-bottom:3px}
        .r3-value pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--font-family-mono,monospace);padding:7px 10px;background:var(--color-background-muted);border-radius:6px}
        .r3-passed>summary{min-height:44px;display:flex;align-items:center;font-size:13px;cursor:pointer;border-top:1px solid var(--color-border);color:var(--ss-success)}
      `);
    }
    if (scene === 'today') {
      for (const card of document.querySelectorAll('a.today-card')) {
        const href = new URL(card.href), topic = href.searchParams.get('topic'), level = Number(href.searchParams.get('level'));
        const title = data.levels?.[topic]?.[level]; if (!title) continue;
        const body = card.querySelector('.today-card__body'), old = card.querySelector('.today-card__meta'); if (!old) continue;
        const meta = make('span', old.textContent, 'r3-today-meta'); old.textContent = title; body.prepend(meta);
      }
      style(`.r3-today-meta{display:block;font-size:12px;color:var(--color-text-secondary);margin-bottom:3px}.today-card{padding-block:12px!important}.today-card__title{flex-wrap:wrap;row-gap:4px}`);
    }
    if (scene === 'profile') {
      const tabs = one('.de-tabs'), nav = make('nav', undefined, 'r3-jumps'); nav.setAttribute('aria-label', 'Profile sections');
      const labels = [['Study plan', 'TRACK AND SECTIONS', 'learning-plan'], ['Account', 'ACCOUNT', 'profile-account'], ['Name', 'YOUR NAME', 'profile-name']];
      const targets = [];
      for (const [label, heading, id] of labels) {
        const h = [...document.querySelectorAll('main h2')].find(n => n.textContent.trim().toUpperCase() === heading); if (!h) throw new Error('Missing Profile section ' + heading);
        const target = h.closest('[id]') || h; if (!target.id) target.id = id; h.tabIndex = -1;
        const a = make('a', label); a.href = '#' + target.id; a.onclick = e => { e.preventDefault(); h.scrollIntoView({block:'start'}); h.focus({preventScroll:true}); history.replaceState(null, '', '#' + target.id); };
        nav.append(a); targets.push({label,id:target.id,h});
      }
      const band = make('div', undefined, 'r3-profile-band'); tabs.before(band); band.append(tabs, nav);
      if (innerWidth < 600) {
        const select = make('select', undefined, 'r3-tool'); select.setAttribute('aria-label', 'Jump to Profile section');
        const prompt = make('option', 'Jump to section'); prompt.value = ''; select.append(prompt);
        for (const target of targets) { const option = make('option', target.label); option.value = target.id; select.append(option); }
        select.onchange = () => { const t = targets.find(t => t.id === select.value); if (t) { t.h.scrollIntoView({block:'start'}); t.h.focus({preventScroll:true}); history.replaceState(null, '', '#' + t.id); } }; nav.replaceChildren(select);
      }
      style(`.r3-profile-band{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--color-border)}.r3-profile-band .de-tabs{border:0!important;margin:0!important;flex:1}.r3-jumps{display:flex;gap:16px}.r3-jumps a{min-height:44px;display:inline-flex;align-items:center;color:var(--color-text-secondary);font-size:13px;text-decoration:underline;text-underline-offset:3px}.r3-profile-band+*{margin-top:0!important}.de-page h2{scroll-margin-top:110px}.de-page h2:focus-visible{outline:2px solid var(--ss-focus);outline-offset:5px}@media(max-width:600px){.r3-profile-band{align-items:start;flex-wrap:wrap;gap:0}.r3-jumps{width:100%;padding:6px 0}.r3-jumps select{width:100%}}`);
    }
    if (scene === 'fde-module') {
      const head = one('.lp-module-overview .lp-head__text'), first = data.module.activities[0];
      const minutes = data.module.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0);
      const hours = Math.floor(minutes / 60), rest = minutes % 60, duration = (hours ? hours + 'h' : '') + (rest ? ' ' + rest + 'm' : '');
      const line = make('p', 'Estimated total: ' + duration.trim() + ' · ' + data.module.activities.length + ' activities', 'r3-note');
      const lead = head.querySelector('.lp-lead'); lead.after(line);
      const button = one('.lp-module-overview .lp-head__actions button');
      const label = [...button.querySelectorAll('span')].find(n => n.textContent.trim() === 'Start module' && n.children.length === 0);
      if (!label) throw new Error('Missing first module CTA label'); label.textContent = 'Start reading · ' + first.estimatedMinutes + ' min';
    }
    if (scene === 'quiz-jump') {
      const heading = one('.ss-question-header__title'), container = make('div', undefined, 'r3-qnav');
      heading.before(container); container.append(heading);
      const toggle = make('button', undefined, 'r3-qnav-toggle'); toggle.type='button';
      while(heading.firstChild)toggle.append(heading.firstChild);toggle.append(document.createTextNode(' ⌄'));heading.append(toggle);
      const panel=make('div',undefined,'r3-qnav-panel');panel.id='r3-question-picker';panel.setAttribute('role','group');panel.setAttribute('aria-label','Choose a question');
      panel.append(make('strong','Jump to question'),make('p','✓ Answered · Empty: unanswered','r3-note'));
      const grid=make('div',undefined,'r3-qnav-grid');
      for(let i=1;i<=6;i++){
        const b=make('button',String(i)+(i<=3?' ✓':''),'r3-qnav-number');b.type='button';b.setAttribute('aria-label','Question '+i+(i<=3?', answered':', unanswered')+(i===6?', current question':''));
        if(i===6)b.setAttribute('aria-current','step');if(i<=3)b.dataset.answered='true';grid.append(b);
      }
      panel.append(grid);container.append(panel);toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','true');
      toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
      container.onkeydown=e=>{if(e.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}};
      style(`.r3-qnav{position:relative;min-width:0}.r3-qnav-toggle{font:inherit;font-weight:inherit;letter-spacing:inherit;min-height:44px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}.r3-qnav-panel{position:absolute;z-index:8;top:calc(100% + 6px);left:0;width:280px;max-width:calc(100vw - 52px);border:1px solid var(--color-border-strong);border-radius:var(--radius-element);background:var(--ss-card-bg);padding:16px;box-shadow:0 8px 28px color-mix(in srgb,var(--ss-ink) 14%,transparent);font-size:14px}.r3-qnav-panel[hidden]{display:none}.r3-qnav-grid{display:grid;grid-template-columns:repeat(3,minmax(44px,1fr));gap:8px}.r3-qnav-number{font:inherit;min-height:44px;border:1px solid var(--color-border);border-radius:var(--radius-inner);background:var(--color-background-muted);color:var(--color-text-primary)}.r3-qnav-number[data-answered]{color:var(--color-text-primary);font-weight:600}.r3-qnav-number[aria-current]{border:2px solid var(--brand-accent);font-weight:700}.r3-qnav button:focus-visible{outline:2px solid var(--ss-focus);outline-offset:3px}`);
    }
  };
})();
