/* Capture current UI and in-memory proposals. All production writes are blocked.
 * Run from any directory after building the app with the placeholder fixture env.
 * SCENES=daily,profile node capture.cjs repeats only selected matched pairs. */
const path = require('node:path'), fs = require('node:fs'), cp = require('node:child_process');
const root = __dirname, repo = path.resolve(root, '../..'); process.chdir(repo);
const {chromium} = require(path.join(repo, 'node_modules/@playwright/test'));
const {pageFor, openScene, settled, first} = require('./fixtures.cjs');
const out = path.join(root, 'screens'); fs.mkdirSync(out, {recursive:true});
const indexFile = path.join(repo, 'node_modules/.cache/ux-round3-index.cjs');
cp.execFileSync(path.join(repo, 'node_modules/.bin/esbuild'), ['shared/coding-index.ts','--bundle','--platform=node','--format=cjs','--outfile='+indexFile,'--log-level=error']);
const {CODING_INDEX} = require(indexFile);
const structure = JSON.parse(fs.readFileSync(path.join(root,'fixtures/structure.json')));
const levels = Object.fromEntries(Object.entries(structure.structure).map(([topic,entry])=>[topic,Object.fromEntries(entry.levels.map(level=>[level.level,level.title]))]));
const desktop = [{theme:'light',width:1280,height:680},{theme:'dark',width:1280,height:680},{theme:'light',width:390,height:844}];
const mobile = [{theme:'light',width:390,height:844},{theme:'dark',width:390,height:844},{theme:'light',width:360,height:800}];
const scenes = [
 {id:'daily',route:'/daily/2026-11-05',modes:desktop},
 {id:'learn-mobile',route:'/learn/web-developer?topic=html',modes:mobile},
 {id:'editor-mobile',route:'/coding/javascript/js-digit-sum',modes:mobile},
 {id:'projects',route:'/coding',modes:desktop},
 {id:'catalogue',route:'/coding/javascript',modes:desktop},
 {id:'results',route:'/coding/javascript/js-fullstack-links-1',modes:desktop},
 {id:'today',fixture:true,modes:desktop},
 {id:'profile',fixture:true,modes:desktop},
 {id:'fde-module',fixture:true,modes:desktop}
];
const wanted = process.env.SCENES?.split(',');
const manifestFile = path.join(root,'capture-manifest.json');
const rows = wanted && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : [];
async function guest(browser, mode) {
 const context = await browser.newContext({viewport:{width:mode.width,height:mode.height},colorScheme:mode.theme,reducedMotion:'reduce',bypassCSP:true});
 const page = await context.newPage(), errors = [], blocked = [];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>{localStorage.setItem('devquiz:color-mode',theme);localStorage.setItem('devshark:consent',JSON.stringify({version:1,analytics:false,marketing:false,decidedAt:Date.now()}));},mode.theme);
 await page.route('**/*',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){blocked.push(route.request().method()+' '+new URL(route.request().url()).pathname);return route.abort();}return route.continue();});
 return {context,page,errors,blocked};
}
async function position(page, scene, width) {
 if (scene === 'projects') {
  const n = page.locator('.cd-projects__rule'); await n.waitFor();
  await page.locator('main').evaluate((main,y)=>main.scrollTop += y-180, (await n.boundingBox()).y);
 }
 if (scene === 'catalogue') {
  const n = page.locator('.cd-search'); await n.waitFor();
  await page.locator('main').evaluate((main,y)=>main.scrollTop += y-(width<600?120:140), (await n.boundingBox()).y);
 }
}
async function geometry(page) {
 return page.evaluate(()=>{
  const box = selector => {const n=document.querySelector(selector);if(!n)return null;const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom};};
  const answers=[...document.querySelectorAll('.ss-daily [role="radio"]')].map(n=>{const b=n.getBoundingClientRect();return{y:b.y,bottom:b.bottom,height:b.height};});
  const check=[...document.querySelectorAll('.ss-daily button')].find(n=>n.textContent.trim()==='Check answer');
  return{overflow:document.documentElement.scrollWidth>innerWidth+1,mainScroll:document.querySelector('main')?.scrollTop,
   breadcrumb:box('.r3-mobile-path, .cd-editor-bar__path'),continue:box('.rm-overview-card'),
   daily:{answers,checkBottom:check?.getBoundingClientRect().bottom},
   topicCount:document.querySelectorAll('.rm-topic-rail [role="radio"]').length,
   resultsCount:document.querySelectorAll('.cd-panel:not([hidden]) .cd-result,.r3-failure').length,
   hasHeader:document.querySelector('.ss-header')?.getBoundingClientRect().height>0,
   title:document.querySelector('main h1')?.textContent};
 });
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try{for(const scene of scenes.filter(s=>!wanted||wanted.includes(s.id)))for(const mode of scene.modes){
  const id=scene.id+'-'+mode.theme+'-'+mode.width+'x'+mode.height;
  const x=scene.fixture ? await pageFor(browser,{...mode,signedIn:true}) : await guest(browser,mode);
  const {page,context}=x;
  try{
   if(scene.fixture){await openScene(page,scene.id);if(scene.id==='profile')await page.getByRole('heading',{name:'Account',exact:true}).waitFor();}
   else{
    await page.goto('https://devshark.app'+scene.route,{waitUntil:'domcontentloaded'});
    await page.locator('main h1,main h2').first().waitFor({timeout:25000});await settled(page);
   }
   if(scene.id==='results'){
    if(mode.width<1024)await page.getByRole('button',{name:'Use the editor here',exact:true}).click();
    await page.getByRole('button',{name:'Run',exact:true}).click();
    await page.locator('.cd-result--fail').first().waitFor({timeout:25000});
    await page.locator('main').evaluate(n=>n.scrollTop=0);
   }
   await position(page,scene.id,mode.width);
   const before=await geometry(page);await page.screenshot({path:path.join(out,id+'-before.png')});
   const beforeText=await page.locator('main').innerText();
   await page.addScriptTag({path:path.join(root,'prototype/after.js')});
   await page.evaluate(({scene,tasks,levels,module})=>window.applyRoundThree(scene,{tasks,levels,module}),{scene:scene.id,tasks:CODING_INDEX.map(({id,title,difficulty,estimatedMinutes})=>({id,title,difficulty,estimatedMinutes})),levels,module:first});
   await position(page,scene.id,mode.width);
   const after=await geometry(page);await page.screenshot({path:path.join(out,id+'-after.png')});
   const afterText=await page.locator('main').innerText();
   const row={id,scene:scene.id,...mode,source:scene.fixture?'current build with local fictional Test Learner / enrollment':'current production guest',baseline:'ca5900282d5e4cc2aa115d5d02585ac056a6d58d',before,after,pageErrors:x.errors||[],blockedNonReadRequests:x.blocked||[],localFixtureWrites:x.localWrites||[],optionalFixtureReads:x.unknown||[],beforeText,afterText};
   const old=rows.findIndex(r=>r.id===id);if(old>=0)rows.splice(old,1);rows.push(row);fs.writeFileSync(manifestFile,JSON.stringify(rows,null,2));
   if(after.overflow||row.pageErrors.length||row.blockedNonReadRequests.length)throw new Error('Capture issues: '+JSON.stringify({overflow:after.overflow,errors:row.pageErrors,blocked:row.blockedNonReadRequests}));
   console.log(id+' captured');
  }finally{await context.close();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
