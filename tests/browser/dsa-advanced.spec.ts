import { test, expect } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { roadmapStructure } from '../../scripts/responsive-fixtures';
import { publicLesson } from '../../lib/learn-lessons';
import { localAuth, storeFakeSession, userWith } from './fake-session';

const settings=JSON.parse(readFileSync('tests/fixtures/api-settings.json','utf8'));
const profile={schemaVersion:2,baseTrack:'frontend',specialization:null,sections:['software-engineer'],goals:['level-up'],experience:'some',studyTime:'15-30',updatedAt:null};
const passed={levels:Object.fromEntries(Array.from({length:5},(_,i)=>[String(i+1),{passed:true,bestPct:100}])),checkpoints:{1:{passed:true,bestPct:100}}};
for(const theme of ['light','dark'] as const){
  test(`${theme}: Advanced belongs to Software Engineer, reads before an attempt and keeps the Premium boundary`,async({page},info)=>{
    const user=userWith({devquiz_learner_profile_v2:profile});await storeFakeSession(page,user);await localAuth(page,{user:()=>user});
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await page.addInitScript(mode=>{localStorage.setItem('devquiz:color-mode',mode);localStorage.setItem('devshark:consent',JSON.stringify({version:1,analytics:false,marketing:false,decidedAt:Date.now()}));},theme);
    let premium=true;let attempts=0;const writes:string[]=[];const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{
      const request=route.request(),url=new URL(request.url()),resource=url.searchParams.get('resource'),op=url.searchParams.get('op');
      if(request.method()!=='GET')writes.push(request.method()+' '+url.pathname);
      if(url.pathname==='/api/settings')return route.fulfill({json:settings});
      if(op==='entitlement')return route.fulfill({json:{tier:premium?'premium':'free',source:premium?'manual':null,currentPeriodEnd:null,cancelAtPeriodEnd:false,inGrace:false,validUntil:null}});
      if(url.pathname==='/api/quiz/roadmap'){
        if(resource==='progress')return route.fulfill({json:{data:{javascript:passed,dsa:passed},extra:{unlocked:[]}}});
        if(resource==='learning-path-catalog')return route.fulfill({json:{versions:{},paths:[]}});
        if(resource==='lesson')return route.fulfill({json:publicLesson(url.searchParams.get('id')!)});
        if(url.searchParams.has('level')){attempts++;return route.fulfill({status:503,json:{error:{code:'fixture',message:'Unexpected attempt'}}});}
        if(!resource)return route.fulfill({json:roadmapStructure()});
      }
      return route.fulfill({status:503,json:{error:{code:'fixture',message:'Local fixture'}}});
    });
    await page.goto('/learn/software-engineer?topic=dsa-advanced');
    await expect(page.locator('.rm-topic-pill').filter({hasText:'DSA Advanced'})).toBeVisible();
    const first=page.getByRole('button',{name:/^Level 1: Heaps and priority queues/});await expect(first).toBeEnabled();
    for(const width of [360,390,430,768,1024,1280,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await first.click();await expect(page.getByRole('heading',{level:1,name:'Represent priorities and relationships'})).toBeVisible();expect(attempts).toBe(0);
    for(const width of [360,390,430,768,1024,1280,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await page.setViewportSize({width:390,height:900});await page.screenshot({path:info.outputPath(`advanced-reading-${theme}.png`),fullPage:true});
    expect((await new AxeBuilder({page}).include('.lp-page').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    premium=false;await page.goto('/learn/software-engineer?topic=dsa-advanced');
    const locked=page.getByRole('button',{name:'Level 1: Heaps and priority queues, Premium',exact:true});await expect(locked).toBeVisible();
    // Premium nodes stay in the tab order and open the upgrade sheet.
    await locked.focus();await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();expect(attempts).toBe(0);expect(writes).toEqual([]);expect(errors).toEqual([]);
  });
}
