// Fresh CommonJS/packages-external probes through the existing F7 harness.
// All operation/failure seams are local; no app or provider call is made.
import assert from 'node:assert/strict';
import { loadFresh } from './cold-start-contracts';
import { complexityGuidance } from '../shared/coding-complexity';

const variantMarker = 'lib/coding/quickjs-variant.ts';
const quickjsPackages = ['quickjs-emscripten', '@jitl/quickjs-singlefile-cjs-release-sync'];
// The actual factories still create the real vendored QuickJS engine. The
// exact SDK ESM export is observed in Node's native loader, without replacing
// its package resolution or changing the preserved SDK implementation body.
// This host-only fixture never installs anything inside the learner VM.
function quickjsPrelude(fault: 'none' | 'boot' | 'dispose' = 'none', esmFactorySeam = true): string {
  return `
    const Module = require('node:module');
    const { realpathSync, readFileSync } = require('node:fs');
    const { dirname, join } = require('node:path');
    const { pathToFileURL } = require('node:url');
    const { createHash } = require('node:crypto');
    const sdk = require('quickjs-emscripten/package.json');
    if (sdk.version !== '0.32.0' || sdk.exports['.'].import !== './dist/index.mjs' || sdk.exports['.'].require !== './dist/index.js') throw new Error('F11 fixture requires the pinned SDK conditional exports');
    if (typeof Module.registerHooks !== 'function') throw new Error('F11 ESM fixture requires Node24 synchronous module hooks');
    const sdkRoot = dirname(require.resolve('quickjs-emscripten/package.json'));
    const esmEntry = pathToFileURL(realpathSync(join(sdkRoot, 'dist/index.mjs'))).href;
    if (createHash('sha256').update(readFileSync(join(sdkRoot, 'dist/index.js'))).digest('hex') !== '20df8520dfd41a66644aff7c6011ef531b8a600624422a07bb8e837e72b47b6b') throw new Error('F11 SDK CJS source pin mismatch');
    const originalLoad = Module._load;
    const seamKey = Symbol.for('devshark.f11.quickjs-factory-seam');
    if (Object.hasOwn(globalThis, seamKey)) throw new Error('F11 factory seam already exists');
    let boots = 0, disposalFaults = 0, esmLoads = 0;
    const factoryCalls = { cjs: 0, esm: 0 };
    const wrapFactory = (factory, route) => function(...args) {
      boots++; factoryCalls[route]++;
      if (${JSON.stringify(fault)} === 'boot') return Promise.reject(new Error('local injected QuickJS boot failure'));
      return Reflect.apply(factory, this, args).then(engine => {
        if (${JSON.stringify(fault)} === 'dispose') {
          const newRuntime = engine.newRuntime.bind(engine);
          engine.newRuntime = (...runtimeArgs) => {
            const runtime = newRuntime(...runtimeArgs), dispose = runtime.dispose.bind(runtime);
            runtime.dispose = () => { dispose(); if (disposalFaults++ === 0) throw new Error('local injected disposal failure'); };
            return runtime;
          };
        }
        return engine;
      });
    };
    Object.defineProperty(globalThis, seamKey, { value: wrapFactory, configurable: true });
    Module._load = function(request, parent, isMain) {
      const value = originalLoad.apply(this, arguments);
      if (request !== 'quickjs-emscripten') return value;
      return { ...value, newQuickJSWASMModuleFromVariant: wrapFactory(value.newQuickJSWASMModuleFromVariant, 'cjs') };
    };
    Module.registerHooks({ load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== esmEntry) return loaded;
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
      if (loaded.format !== 'module' || createHash('sha256').update(source).digest('hex') !== '5fdddb928e1deb739ae28d3216627607fee5cf759431af4784500ddf6e34343f') throw new Error('F11 SDK ESM source pin mismatch');
      if (!source.includes('export*from"quickjs-emscripten-core";') || source.includes('__f11OriginalFactory')) throw new Error('F11 SDK export anchor changed');
      esmLoads++;
      if (!${JSON.stringify(esmFactorySeam)}) return loaded;
      // One explicit export shadows the existing star re-export. The real
      // core factory and every byte of the original SDK body are retained.
      const delegatedExport = '\\nimport { newQuickJSWASMModuleFromVariant as __f11OriginalFactory } from "quickjs-emscripten-core";\\nconst __f11ObservedFactory = globalThis[Symbol.for("devshark.f11.quickjs-factory-seam")](__f11OriginalFactory, "esm");\\nexport { __f11ObservedFactory as newQuickJSWASMModuleFromVariant };\\n';
      return { ...loaded, source: source + delegatedExport };
    }});
    const engineLoaded = () => esmLoads > 0 || Object.keys(require.cache).some(path => path.includes('/node_modules/quickjs-emscripten/'));
  `;
}
const simpleRun = `{ code: 'const answer = n => n + 1;', calls: ['answer(2)'], expectations: [3] }`;

export async function lazyCodingRuntimeContracts(): Promise<void> {
  const failures: Error[]=[];
  const check = async (name: string, body: () => Promise<void>) => {
    try { await body(); console.log('PASS lazy coding runtime: '+name); }
    catch (error) { console.error('FAIL lazy coding runtime: '+name,error); failures.push(error instanceof Error ? error : new Error(String(error))); }
  };
  await check('F11-34 fixture delegates both native ESM and historical CJS factories to the real vendored engine', async () => {
    const fresh=await loadFresh('lib/coding/quickjs-variant.ts', `(async()=>{
      const cjs=require('quickjs-emscripten'),esm=await import('quickjs-emscripten'),values=[];
      for(const sdk of [cjs,esm]) {
        const engine=await sdk.newQuickJSWASMModuleFromVariant(mod.default),runtime=engine.newRuntime();
        try { const context=runtime.newContext();try { const result=context.evalCode('1 + 2');try {
          if(result.error)throw new Error('real QuickJS fixture operation failed');values.push(context.dump(result.value));
        }finally{(result.error??result.value).dispose();} }finally{context.dispose();} }finally{runtime.dispose();}
      }
      return {values,boots,factoryCalls,esmLoads};
    })()`,{},[],quickjsPrelude());
    assert.deepEqual(fresh.probe,{values:[3,3],boots:2,factoryCalls:{cjs:1,esm:1},esmLoads:1});
  });
  const faultProbe=`(async()=>{
    const cjs=require('quickjs-emscripten'),esm=await import('quickjs-emscripten'),outcomes=[];
    for(const sdk of [cjs,esm]) {try{const engine=await sdk.newQuickJSWASMModuleFromVariant(mod.default);const runtime=engine.newRuntime();runtime.dispose();outcomes.push('returned');}catch(error){outcomes.push(error.message);}}
    return {outcomes,boots,factoryCalls,esmLoads};
  })()`;
  const expectedFault={outcomes:['local injected QuickJS boot failure','local injected QuickJS boot failure'],boots:2,factoryCalls:{cjs:1,esm:1},esmLoads:1};
  await check('F11-34 fixture boot fault reaches the actual ESM and historical CJS factory exports', async () => {
    const fresh=await loadFresh('lib/coding/quickjs-variant.ts',faultProbe,{},[],quickjsPrelude('boot'));
    assert.deepEqual(fresh.probe,expectedFault);
  });
  await check('F11-34 disabling only the ESM factory seam is detected by the same boot-fault oracle', async () => {
    const fresh=await loadFresh('lib/coding/quickjs-variant.ts',faultProbe,{},[],quickjsPrelude('boot',false));
    assert.throws(()=>assert.deepEqual(fresh.probe,expectedFault),assert.AssertionError);
    assert.deepEqual(fresh.probe,{outcomes:['local injected QuickJS boot failure','returned'],boots:1,factoryCalls:{cjs:1,esm:0},esmLoads:1});
  });
  await check('F11-34 importing sandbox constructs no QuickJS package or variant', async () => {
    const fresh=await loadFresh('lib/coding/sandbox.ts','({loaded:globalThis.__evaluated??[]})',{VERCEL:'1'},[variantMarker]);
    for(const name of quickjsPackages) assert.ok(!fresh.packages.includes(name),name);
    assert.deepEqual(fresh.probe,{loaded:[]});
  });
  await check('F11-34 first concurrent real operations share one engine, failures keep it cached', async () => {
    const fresh=await loadFresh('lib/coding/sandbox.ts',`(async()=>{
      const before={loaded:engineLoaded(),boots};
      const runs=await Promise.all([mod.runInQuickJS(${simpleRun}),mod.runInQuickJS(${simpleRun})]);
      const failed=await mod.runInQuickJS({code:'const answer=()=>{throw new Error("ordinary learner failure");};',calls:['answer()'],expectations:[1]});
      const next=await mod.runInQuickJS(${simpleRun});
      return {before,after:engineLoaded(),boots,factoryCalls,esmLoads,markers:globalThis.__evaluated??[],runs,failed,next};
    })()`,{},[variantMarker],quickjsPrelude());
    const result=fresh.probe as any;
    assert.deepEqual(result.before,{loaded:false,boots:0});
    assert.equal(result.after,true);assert.equal(result.boots,1);
    assert.deepEqual(result.factoryCalls,{cjs:0,esm:1});assert.equal(result.esmLoads,1);
    assert.deepEqual(result.markers,[variantMarker]);
    for(const run of [...result.runs,result.next]) {
      assert.equal(run.codeError,null);assert.equal(run.timedOut,false);
      assert.deepEqual(run.results,[{pass:true,actual:'3',error:null}]);
    }
    assert.equal(result.failed.codeError,null);assert.equal(result.failed.results[0].pass,false);
    assert.match(result.failed.results[0].error,/ordinary learner failure/);
  });
  await check('F11-34 rejected boot stays cached, matching existing behavior', async () => {
    const fresh=await loadFresh('lib/coding/sandbox.ts',`(async()=>{
      const errors=[];for(let i=0;i<2;i++){try{await mod.runInQuickJS(${simpleRun});}catch(error){errors.push(error.message);}}
      return {boots,errors,factoryCalls,esmLoads};
    })()`,{},[],quickjsPrelude('boot'));
    assert.deepEqual(fresh.probe,{boots:1,errors:['local injected QuickJS boot failure','local injected QuickJS boot failure'],factoryCalls:{cjs:0,esm:1},esmLoads:1});
  });
  await check('F11-34 disposal failure preserves result then permits a fresh-engine retry', async () => {
    const fresh=await loadFresh('lib/coding/sandbox.ts',`(async()=>{
      const first=await mod.runInQuickJS(${simpleRun});const afterFirst=boots;
      const second=await mod.runInQuickJS(${simpleRun});return {first,second,afterFirst,boots,disposalFaults,factoryCalls,esmLoads};
    })()`,{},[],quickjsPrelude('dispose'));
    const result=fresh.probe as any;assert.equal(result.afterFirst,1);assert.equal(result.boots,2);assert.equal(result.disposalFaults,2);
    assert.deepEqual(result.factoryCalls,{cjs:0,esm:2});assert.equal(result.esmLoads,1);
    for(const run of [result.first,result.second]) assert.deepEqual(run.results,[{pass:true,actual:'3',error:null}]);
  });

  const assumptions='Static estimate, not a proof. Assumes input-sized collections, bounded callbacks, constant-time indexing and average constant-time Map/Set operations. Numeric loop bounds are treated as magnitudes, not bit lengths. Sort is modelled as n log n; actual engine behaviour can differ. Timing and extra space are not measured.';
  await check('F11-37 React/design return their full unknown reports without touching TypeScript', async () => {
    const tasks = (['react','system-design'] as const).map(track=>({track,prompt:'Target: O(n) time.',tests:[{call:'answer([1])',expected:1}]}));
    const fresh=await loadFresh('lib/coding/complexity.ts',`(()=>{
      const reports=${JSON.stringify(tasks)}.map(task=>{try{return mod.assessComplexity(task,'not valid code ((( ');}catch(error){return {threw:error.message};}});
      return {reports,attempts};
    })()`,{},[],`
      const Module=require('node:module'),originalLoad=Module._load;let attempts=0;
      Module._load=function(request,parent,isMain){if(request==='typescript'){attempts++;throw new Error('local TypeScript load forbidden');}return originalLoad.apply(this,arguments);};
    `);
    assert.deepEqual(fresh.probe,{attempts:0,reports:tasks.map(task=>{const guidance=complexityGuidance(task);return {time:null,assessment:'unknown',explanation:guidance.note,assumptions,guidance};})});
  });
  await check('F11-37 JS/TS boot failure remains loud, retries and later calls reuse the compiler', async () => {
    const fresh=await loadFresh('lib/coding/complexity.ts',`(()=>{
      const task={track:'javascript',prompt:'Target: O(n) time.',tests:[{call:'answer([1,2])',expected:3}]};
      const code='function answer(xs){let total=0;for(let i=0;i<xs.length;i++)total+=xs[i];return total;}';
      let error=null;try{mod.assessComplexity(task,code);}catch(caught){error=caught.message;}
      const typed=mod.assessComplexity({...task,track:'typescript'},code),ordinary=mod.assessComplexity(task,code);
      return {error,attempts,typed:{time:typed.time,assessment:typed.assessment},ordinary:{time:ordinary.time,assessment:ordinary.assessment},loaded:Object.keys(require.cache).some(path=>path.includes('/node_modules/typescript/'))};
    })()`,{},[],`
      const Module=require('node:module'),originalLoad=Module._load;let attempts=0;
      Module._load=function(request,parent,isMain){if(request==='typescript'&&++attempts===1)throw new Error('local injected TypeScript load failure');return originalLoad.apply(this,arguments);};
    `);
    assert.deepEqual(fresh.probe,{error:'local injected TypeScript load failure',attempts:2,typed:{time:'O(n)',assessment:'within-target'},ordinary:{time:'O(n)',assessment:'within-target'},loaded:true});
  });
  if(failures.length) throw new AggregateError(failures,'F11-34/37 lazy runtime contracts failed');
}
