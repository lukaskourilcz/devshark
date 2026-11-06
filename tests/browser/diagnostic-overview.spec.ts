import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {storeFakeSession,localAuth} from './fake-session';
import {pathById,publicManifest,inventoryFor} from '../../lib/learning-paths/catalog';

// Built UI and local wire/auth fixtures only. No real account, grading, enrollment
// or database call occurs; server evidence is checked in handler contracts.
const path=pathById('fde')!;
const manifest=publicManifest(path);
const enrollment={enrollmentId:'LOCALDIAGNOSTIC00000000',pathId:'fde',curriculumVersion:path.version,baseTrackAtEnrollment:null,status:'active',startedAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z'};
const competencies=path.competencies.map(one=>({competencyId:one.id,state:one.id==='integration'?'gap':one.id==='handoff'?'demonstrated':'not_assessed',score:one.id==='integration'?0.3333:one.id==='handoff'?1:null,assessedItems:['integration','handoff'].includes(one.id)?3:0}));
for(const theme of ['light','dark'] as const) test(`${theme}: diagnostic report reflows, distinguishes unknown evidence and offers a keyboard link`,async({page},info)=>{
  await storeFakeSession(page);await localAuth(page);
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.addInitScript(theme=>{localStorage.setItem('devquiz:color-mode',theme);localStorage.setItem('devshark:consent',JSON.stringify({version:1,analytics:false,marketing:false,decidedAt:Date.now()}));},theme);
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url()),op=url.searchParams.get('op')??url.pathname.split('/').pop();
    if(url.searchParams.get('resource')==='learning-path-catalog')return route.fulfill({json:{versions:{fde:path.version},paths:[{manifest,availability:'available',inventory:inventoryFor('fde')}]}});
    if(op==='entitlement')return route.fulfill({json:{tier:'premium',source:'manual',currentPeriodEnd:null,cancelAtPeriodEnd:false,inGrace:false,validUntil:null}});
    if(op==='learning-path-enrollment')return route.fulfill({json:{enrollments:[enrollment]}});
    if(op==='learning-path-progress')return route.fulfill({json:{enrollment,modules:[],competencies,recommendedBridges:['fde-bridge-backend-data'],nextActivityId:null,guidedComplete:false,artifacts:{submitted:0,total:3},dueActivityIds:[]}});
    return route.fulfill({status:503,json:{error:{code:'offline',message:'Local test fixture'}}});
  });
  await page.goto('/learn/forward-deployed-engineer/path');
  const report=page.getByRole('region',{name:'Diagnostic overview'});await expect(report).toBeVisible();
  await expect(report).toContainText('Worth practising');await expect(report).toContainText('33% · Items assessed: 3');
  await expect(report).toContainText('100% · Items assessed: 3');
  const unknown=report.getByRole('listitem').filter({hasText:'Python comprehension'});await expect(unknown).toContainText('Not assessed');await expect(unknown).not.toContainText('0%');
  for(const width of [360,390,768,1024,1280,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await report.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    if(width===360||width===1440)await report.screenshot({path:info.outputPath(`diagnostic-${theme}-${width}.png`)});
  }
  const link=report.getByRole('link',{name:'Open the diagnostic'});await link.focus();await expect(link).toBeFocused();
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await expect(link).toBeFocused();
  await expect(link).toHaveAttribute('href','/learn/forward-deployed-engineer/path/fde-v1-diagnostic?activity=fde-v1-diagnostic-check');
  // 200% text in a wide font (Verdana, or DejaVu Sans on the Linux runner), so a
  // long word overflows here on any machine if it can overflow on one (B14, #510).
  await page.setViewportSize({width:360,height:900});await page.addStyleTag({content:'html {font-size:200% !important;} body, body * {font-family:Verdana,"DejaVu Sans",sans-serif !important;}'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await report.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  const findings=await new AxeBuilder({page}).include('section[aria-labelledby="path-diagnostic-title"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(findings.violations.map(v=>v.id)).toEqual([]);
});

// Owner hold: keep these end-to-end checks for the future FDE release.
test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
