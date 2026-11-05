/* Review-only second-round refinement, layered on previous-proposal.js.
   No product imports, persistence, grading, account action or server mutation. */
window.applyOwnerRevision = function(scene) {
  const $=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
  const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
  document.body.dataset.ownerRevision=scene;
  const style=node('style','');style.textContent=`
  /* One global minimum gutter. Includes safe-area space, not nested padding. */
  [data-owner-revision] #main-content {padding-inline:64px!important;}
  [data-owner-revision] .ss-route {max-width:min(1200px,100%)!important;}
  [data-owner-revision].review-focus #main-content {padding-block:24px!important;}
  [data-owner-revision].review-focus #main-content > div {display:flex!important;flex-direction:column;}
  [data-owner-revision].review-focus .ss-route {flex:0 0 auto!important;margin-block:auto!important;width:100%;}
  [data-owner-revision].review-workspace .cd-workbench__grid {height:min(640px,calc(100dvh - 160px))!important;}
  [data-owner-revision].review-workspace.review-stages .cd-workbench__grid {height:min(584px,calc(100dvh - 216px))!important;}
  [data-owner-revision] .cd-pane--output > .cd-tabs > button {position:relative;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;}
  [data-owner-revision] .cd-pane--output > .cd-tabs > button::after {display:none;}
  [data-owner-revision] .cd-pane--output > .cd-tabs > button[aria-selected=true]::after {content:'';display:block;position:absolute;left:10px;right:10px;bottom:4px;height:6px;background:var(--brand-accent);mask-image:var(--ss-wave-5);mask-repeat:repeat-x;mask-size:24px 6px;}
  [data-owner-revision] .cd-pane--output > .cd-tabs > button:nth-child(2)[aria-selected=true]::after {mask-image:var(--ss-wave-2);}
  [data-owner-revision] .cd-pane--output > .cd-tabs > button:nth-child(3)[aria-selected=true]::after {mask-image:var(--ss-wave-7);}
  [data-owner-revision] .cd-stage-nav {justify-content:flex-end;margin-top:12px!important;gap:8px!important;min-height:44px;}
  [data-owner-revision] .cd-stage-nav :is(a,button) {min-width:36px;height:36px;min-height:36px;padding:0 8px;font-size:13px;}
  [data-owner-revision] .cd-stage-nav .r2-complete {color:var(--brand-accent)!important;background:var(--brand-accent-soft)!important;border:1px solid var(--brand-accent)!important;}
  [data-owner-revision] .cd-stage-nav [aria-current=step] {outline:2px solid var(--brand-accent);outline-offset:2px;}
  [data-owner-revision] .cd-next {border:0!important;box-shadow:none!important;background:color-mix(in srgb,var(--brand-accent) 23%,var(--color-background-surface))!important;}
  [data-owner-revision='coding-track'] .cd-page{gap:16px!important;}
  .r2-track-head h1 {margin-block:0!important;}
  .r2-track-head > p {font-size:14px;line-height:1.45!important;}
  .r2-track-head {text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;margin:0 auto 12px;max-width:760px;}
  .r2-track-head h1{margin-inline:auto;}
  .r2-track-head .cd-lead{margin-block:4px;}
  .r2-path-link {font-size:14px;color:var(--color-text-secondary);margin:0 0 8px;}
  .r2-path-link a {color:var(--brand-accent);text-underline-offset:3px;}
  .r2-catalogue {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px;margin:8px 0 0;border-top:1px solid var(--ss-card-line);}
  .r2-catalogue ul {list-style:none;padding:0;margin:0;min-width:0;}
  .r2-catalogue .cd-row {min-height:44px;padding-block:8px;}
  .r2-catalogue .cd-row__title {font-size:14px;line-height:1.3;}
  .r2-catalogue .cd-row__meta {font-size:12px;}
  .r2-catalogue .cd-row-item {border-bottom:1px solid var(--ss-card-line);}
  .r2-pager {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0 20px;font-size:13px;color:var(--color-text-secondary);}
  .r2-pager button {min-height:44px;padding:6px 14px;border:1px solid var(--ss-card-line);border-radius:8px;background:var(--color-background-surface);color:var(--color-text-primary);}
  [data-owner-revision='coding-track'] .cd-projects {margin-top:20px;padding-top:24px;border-top:1px solid var(--ss-card-line);}
  [data-owner-revision='quiz-results'] .quiz-results {max-width:none!important;}
  [data-owner-revision='quiz-results'] .quiz-results__summary {align-items:center!important;text-align:center!important;}
  [data-owner-revision='quiz-results'] .quiz-results__summary > * {align-self:center!important;}
  [data-owner-revision='quiz-results'] .quiz-review-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:16px!important;}
  [data-owner-revision='quiz-results'] .quiz-review-grid > * {min-width:0;}
  .r2-profile-grid {display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px!important;align-items:stretch!important;}
  .r2-profile-grid > * {width:100%;min-width:0;padding:24px!important;}
  .r2-profile-track{grid-column:1;grid-row:1;}
  .r2-profile-name{grid-column:2;grid-row:1;}
  .r2-profile-account{grid-column:1;grid-row:2;}
  .r2-profile-advisor{grid-column:1/-1;grid-row:3;align-self:start;}
  .r2-profile-career{grid-column:2;grid-row:2;align-self:start;}
  .r2-profile-advisor h1,.r2-profile-advisor h2 {font-size:18px!important;}
  [data-owner-revision='fde-module'] .lp-activity--next {box-shadow:none!important;border:1px solid var(--ss-card-line)!important;background:color-mix(in srgb,var(--brand-accent) 10%,var(--color-background-surface));border-radius:10px;padding:16px;}
  .r2-next-status {color:var(--brand-accent);font-weight:650;display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-left:8px;}
  @media(max-width:1000px){[data-owner-revision='quiz-results'] .quiz-review-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;}}
  @media(max-width:700px){
    [data-owner-revision] #main-content {padding-inline:26px!important;}
    [data-owner-revision].review-focus .ss-route {margin-block:auto!important;}
    [data-owner-revision].review-workspace .cd-workbench__grid,[data-owner-revision].review-workspace.review-stages .cd-workbench__grid {height:auto!important;}
    .r2-catalogue,.r2-profile-grid {grid-template-columns:1fr!important;}
    .r2-profile-grid > * {grid-column:1;grid-row:auto;}
    .r2-profile-track{order:0;}.r2-profile-account{order:1;}.r2-profile-name{order:2;}.r2-profile-advisor{order:3;}.r2-profile-career{order:4;}
    [data-owner-revision='quiz-results'] .quiz-review-grid {grid-template-columns:1fr!important;}
  }`;
  document.head.append(style);
  // A root breadcrumb has no parent. Nested breadcrumbs must not repeat h1.
  all('.review-crumbs').forEach(nav=>{if(!nav.querySelector('a')){nav.remove();return;}const leaf=$('[aria-current]',nav),h=$('main h1');if(leaf&&h&&leaf.textContent.trim().toLowerCase()===h.textContent.trim().toLowerCase()){leaf.previousElementSibling?.remove();leaf.remove();}});
  if(scene==='coding-track'){
    const page=$('.cd-page'),head=$('header',page),path=$('.cd-projects',page),crumb=$('.review-crumbs',page);
    if(crumb){const leaf=$('[aria-current]',crumb);if(leaf){leaf.previousElementSibling?.remove();leaf.remove();}}
    head?.classList.add('r2-track-head');
    const text=node('p','r2-path-link','Want a project that grows with you? '),a=node('a','','Explore JavaScript Paths ↓');a.href='#r2-paths';text.append(a);$('.cd-lead',head)?.after(text);
    if(path){path.id='r2-paths';page.append(path);}
    const rows=all('.cd-row-item',page),bands=all('.cd-band',page);const table=node('div','r2-catalogue'),left=node('ul',''),right=node('ul','');table.append(left,right);
    const pager=node('nav','r2-pager');pager.setAttribute('aria-label','Exercise pages');const previous=node('button','','← Previous'),next=node('button','','Next →'),count=node('span','');previous.type=next.type='button';pager.append(previous,count,next);
    if(bands[0])bands[0].before(table,pager);else page.append(table,pager);bands.forEach(e=>e.remove());let current=0;
    const render=()=>{left.replaceChildren();right.replaceChildren();const slice=rows.slice(current*20,current*20+20);slice.forEach((row,i)=>(i<10?left:right).append(row));previous.disabled=current===0;next.disabled=(current+1)*20>=rows.length;count.textContent=`${current*20+1}–${Math.min((current+1)*20,rows.length)} of ${rows.length} · Page ${current+1} of ${Math.ceil(rows.length/20)}`;};
    previous.onclick=()=>{if(current>0){current--;render();}};next.onclick=()=>{if((current+1)*20<rows.length){current++;render();}};render();
  }
  if(scene==='evolving'){
    const nav=$('.cd-stage-nav');if(nav){const buttons=all('a,button',nav);nav.replaceChildren(node('span','','Level:'));buttons.forEach((b,i)=>{b.textContent=String(i+1);if(i<2){b.classList.add('r2-complete');b.textContent+=' ✓';b.disabled=false;b.setAttribute('aria-label','Level '+(i+1)+', completed');if(i===0)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}else if(i===2){b.disabled=false;b.removeAttribute('aria-current');b.setAttribute('aria-label','Level 3, available');}else{b.disabled=true;b.removeAttribute('aria-current');}nav.append(b);});}
  }
  if(scene==='daily'){
    $('.ss-daily__next')?.remove();const lead=$('.ss-info-lead')||$('.ss-daily header p');if(lead)lead.textContent='TypeScript types describe data. Here, a type comes from a value.';
  }
  if(scene==='learn'){
    const content=$('.review-learn-content');const lead=content&&all('p',content).find(e=>/HTML|CSS|JavaScript|web/i.test(e.textContent));
    if(lead){lead.style.maxWidth='66ch';lead.textContent='HTML structures webpages with headings, links, images and forms. Learn the elements that make a page clear and accessible.';}
  }
  if(scene==='profile'){
    const left=$('[data-column=learning]'),right=$('[data-column=account]');const grid=left?.parentElement;
    if(grid&&right){const panels=[...all('.ss-panel',left),...all('.ss-panel',right)].filter(e=>!e.parentElement.closest('.ss-panel'));const track=panels.find(e=>/Track and Sections/i.test(e.textContent)),account=panels.find(e=>/Sign out on all devices/.test(e.textContent)),name=panels.find(e=>/Sharkname|Your name/i.test(e.textContent)),advisor=panels.find(e=>/advisor/i.test(e.textContent));
      grid.classList.add('r2-profile-grid');grid.replaceChildren();
      for(const[e,cls]of [[track,'track'],[name,'name'],[account,'account'],[advisor,'advisor']])if(e){e.classList.add('r2-profile-'+cls);grid.append(e);}
      panels.filter(e=>![track,name,account,advisor].includes(e)).forEach(e=>{e.classList.add('r2-profile-career');grid.append(e);});
    }
  }
  if(scene==='fde-module')all('.lp-activity--next').forEach(e=>{const target=$('.lp-activity__title',e)||e.firstElementChild;target?.append(node('span','r2-next-status','Next →'));});
};
