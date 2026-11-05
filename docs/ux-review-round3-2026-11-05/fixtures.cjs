const fs=require('node:fs');
const repo=require('node:path').resolve(__dirname,'../..');
const {expect}=require(require('node:path').join(repo,'node_modules/@playwright/test'));
const auth=require('./auth-fixture.cjs');
const settings=JSON.parse(fs.readFileSync(__dirname+'/fixtures/settings.json'));settings.learningPaths.paths.fde={enabled:true,version:1,availability:'available'};
const catalog=JSON.parse(fs.readFileSync(__dirname+'/fixtures/catalog.json'));
const structure=JSON.parse(fs.readFileSync(__dirname+'/fixtures/structure.json'));
const manifest=catalog.paths[0].manifest,first=manifest.modules.find(m=>!m.optional&&!m.shelf);
const enrollment={enrollmentId:'LOCALREVIEWFDE0001',pathId:'fde',curriculumVersion:1,status:'active',baseTrackAtEnrollment:'frontend',startedAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-05T00:00:00Z'};
const profile={schemaVersion:2,baseTrack:'frontend',specialization:'fde',sections:['software-engineer'],goals:['level-up'],experience:'some',studyTime:'30-60',updatedAt:'2026-11-01T00:00:00Z'};
const user={...auth.fakeUser,user_metadata:{full_name:'Test Learner',devquiz_track:'frontend',devquiz_learning_preference_v1:{schemaVersion:1,baseTrack:'frontend',specialization:'fde'},devquiz_learner_profile_v2:profile}};
const questions=[{"id": "review-q1", "category": "javascript", "difficulty": 1, "introduction": "", "question": "What does this expression return?\n\n```javascript\ntypeof null\n```", "options": ["object", "string", "null", "undefined"]}, {"id": "review-q2", "category": "javascript", "difficulty": 1, "introduction": "", "question": "Which value is a number?", "options": ["42", "\"42\"", "null", "undefined"]}, {"id": "review-q3", "category": "javascript", "difficulty": 1, "introduction": "", "question": "Which method creates a new array?", "options": ["map", "push", "pop", "splice"]}, {"id": "review-q4", "category": "javascript", "difficulty": 1, "introduction": "", "question": "Which keyword declares a block-scoped variable?", "options": ["let", "with", "this", "return"]}, {"id": "review-q5", "category": "javascript", "difficulty": 1, "introduction": "", "question": "Which value is falsy?", "options": ["0", "\"hello\"", "[]", "{}"]}, {"id": "review-q6", "category": "javascript", "difficulty": 1, "introduction": "", "question": "Which method converts JSON text into a value?", "options": ["JSON.parse", "JSON.stringify", "Object.keys", "Array.from"]}];
const stats={id:'local-stats',user_id:user.id,email:null,name:'Test Learner',picture:null,total_quizzes:12,total_correct:76,total_questions:100,current_streak:3,longest_streak:5,last_quiz_date:'2026-11-04',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-11-05T00:00:00Z'};
async function pageFor(browser,{theme='dark',width=1280,height=800,signedIn=true}={}){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'});const page=await context.newPage();const unknown=[],errors=[],localWrites=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>{localStorage.setItem('devquiz:color-mode',theme);localStorage.setItem('devquiz:quiz-setup:v1',JSON.stringify({count:10,difficulty:'mixed',categories:['javascript']}));localStorage.setItem('devshark:consent',JSON.stringify({version:1,analytics:false,marketing:false,decidedAt:Date.now()}));},theme);
 if(signedIn){await auth.storeFakeSession(page,user);await auth.localAuth(page,{user:()=>user});}
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),resource=url.searchParams.get('resource'),op=url.searchParams.get('op')||url.pathname.split('/').pop();const json=x=>route.fulfill({json:x});
  if(!['GET','HEAD','OPTIONS'].includes(req.method()))localWrites.push(req.method()+' '+url.pathname);
  if(url.pathname==='/api/settings')return json(settings);
  if(resource==='learning-path-catalog')return json(catalog);
  if(op==='entitlement')return json({tier:'premium',source:'manual',currentPeriodEnd:null,cancelAtPeriodEnd:false,inGrace:false,validUntil:null});
  if(op==='learning-path-enrollment')return json({enrollments:[enrollment]});
  if(op==='learning-path-progress')return json({enrollment,modules:[],competencies:[],recommendedBridges:[],nextActivityId:first.activities[0].id,guidedComplete:false,artifacts:{submitted:0,total:0},dueActivityIds:[]});
  if(op==='stats')return json({data:stats});
  if(op==='xp')return json({data:{quest_xp:420,by_subject:{webdev:420}}});
  if(op==='learning-preference')return json({preference:{schemaVersion:1,baseTrack:'frontend',specialization:'fde'},legacyTrack:'frontend',profile,missingProfileFields:[]});
  if(op==='friends-handle')return json({handle:'calmShark1',discoverable:false,country:null,canChangeAt:null});
  if(op==='identity')return json({showRealName:false,showPhoto:false,realName:'Test Learner',photo:null});
  if(op==='leaderboard-name')return json({mode:'nickname',nickname:'calmShark1',accountName:'Test Learner',showPhoto:false});
  if(op==='wallet')return json({balance:80,earned:80,spent:0,ledger:[]});
  if(op==='freezes')return json({balance:1,monthlyGranted:2,protectedDates:[]});
  if(op==='github-connection')return json({connected:false,available:false});
  if(op==='streak' || op==='streak-freezes')return json({current:3,longest:5,freezes:1,canProtect:false,protectedDates:[]});
  if(op==='bookmarks')return json({bookmarks:[]});
  if(op==='advisor')return json({recommendations:[],message:null});
  if(resource==='progress')return json({data:{},extra:{unlocked:[]}});
  if(url.pathname==='/api/quiz/roadmap'&&!resource)return json(structure);
  if(resource==='concept-due'||resource==='coding-due'||op==='concept-due')return json({items:[],due:[],total:0});
  if(resource==='practice-session'||op==='practice-session')return json({session:null});
  if(url.pathname==='/api/quiz/questions')return json({sessionId:'local-ux-review-session',expiresAt:Date.now()+3600000,questions});
  if(url.pathname==='/api/quiz/challenge'&&resource==='leaderboard')return json({top:[],champion:null});
  if(url.pathname==='/api/quiz/challenge')return json({sessionId:'local-challenge',runToken:'local-run',questions});
  if(url.pathname==='/api/quiz/submit')return json({"totalQuestions": 6, "correctAnswers": 3, "percentage": 50, "questXp": 0, "results": [{"questionId": "review-q1", "selectedIndex": 0, "correctAnswer": 0, "isCorrect": true, "explanation": "typeof null returns object for historical compatibility."}, {"questionId": "review-q2", "selectedIndex": 0, "correctAnswer": 0, "isCorrect": true, "explanation": "42 is a numeric literal."}, {"questionId": "review-q3", "selectedIndex": 0, "correctAnswer": 0, "isCorrect": true, "explanation": "map returns a new array."}, {"questionId": "review-q4", "selectedIndex": 2, "correctAnswer": 0, "isCorrect": false, "explanation": "let is block scoped."}, {"questionId": "review-q5", "selectedIndex": 2, "correctAnswer": 0, "isCorrect": false, "explanation": "Zero is a falsy number."}, {"questionId": "review-q6", "selectedIndex": 2, "correctAnswer": 0, "isCorrect": false, "explanation": "JSON.parse reads JSON text."}]});
  unknown.push({path:url.pathname,op,resource});return route.fulfill({status:503,json:{error:{code:'local_fixture',message:'This optional read is not supplied by the local review fixture.'}}});
 });
 return{page,context,unknown,errors,localWrites};
}
async function settled(page){await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity),null,{timeout:5000}).catch(()=>{});}
async function openScene(page,name){
 if(name==='quiz-active'||name==='quiz-result'){
  await page.goto('http://127.0.0.1:4184/quiz');await page.getByRole('button',{name:'Start quiz',exact:true}).click();await expect(page.getByRole('radio',{name:'object',exact:true})).toBeVisible();
  if(name==='quiz-result'){for(let i=0;i<6;i++){await page.getByRole('radio').nth(i<3?0:2).click();await page.getByRole('button',{name:i===5?'Submit quiz':'Next',exact:true}).click();}await expect(page.getByRole('heading',{level:1})).toHaveText('3 / 6');}
 }else if(name==='challenge-active'){await page.goto('http://127.0.0.1:4184/challenge');await page.getByRole('button',{name:'Start',exact:true}).click();await expect(page.getByRole('radiogroup')).toBeVisible();}
 else await page.goto('http://127.0.0.1:4184/'+({profile:'profile',today:'today','fde-module':'learn/forward-deployed-engineer/path/'+first.id}[name]||name));
 await settled(page);
}
module.exports={pageFor,openScene,settled,repo,manifest,first};
