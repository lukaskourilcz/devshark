// Fail-closed controls for the real normal builders and retained runtime.
// Native hook probes use only fixed code; no app or provider VM is called.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { stripUnusedQuickJSWasm, assertQuickJSBundleMetadata, pinnedQuickJSBundle } from './quickjs-bundle.mjs';

const dependency = createRequire(import.meta.url);
const retainedEntry = dependency.resolve('@jitl/quickjs-singlefile-cjs-release-sync');
const sdkEntry = dependency.resolve('quickjs-emscripten');
const coreEntry = createRequire(sdkEntry).resolve('quickjs-emscripten-core');
const source = readFileSync(retainedEntry, 'utf8');
const root = process.cwd();
const normalized = (value) => value.replaceAll('\\','/');
const requiredFiles = [coreEntry, retainedEntry, join(root,'lib/coding/vendor/quickjs-node24.cjs')].map((file)=>normalized(realpathSync(file)));
const clone = (value) => JSON.parse(JSON.stringify(value));

// Import the real normal CLI builder, not a look-alike option object. It also
// writes the final F11-19 passive digest and preserves its existing SDK smoke.
const {guestBundle,sandboxBundle} = await import('./build-react-runner.mjs');
for (const [name,result] of [['guest',guestBundle],['worker',sandboxBundle]]) {
  const actual = result.metafile;
  test(`${name}: actual normal-builder metadata retains core/loader/custom payload`,()=>assertQuickJSBundleMetadata(actual));
  for (const file of requiredFiles) {
    const input = Object.keys(actual.inputs).find((key)=>normalized(resolve(root,key))===file);
    assert.ok(input,`${name}: actual required input exists before mutation`);
    test(`${name}: missing retained input fails closed (${file.split('/').slice(-2).join('/')})`,()=>{
      const changed=clone(actual);delete changed.inputs[input];
      for(const output of Object.values(changed.outputs))delete output.inputs?.[input];
      assert.throws(()=>assertQuickJSBundleMetadata(changed));
    });
    test(`${name}: zero retained output contribution fails closed (${file.split('/').slice(-2).join('/')})`,()=>{
      const changed=clone(actual);
      for(const output of Object.values(changed.outputs))if(output.inputs?.[input])output.inputs[input].bytesInOutput=0;
      assert.throws(()=>assertQuickJSBundleMetadata(changed));
    });
  }
  test(`${name}: an unused default variant in actual graph fails closed`,()=>{
    const changed=clone(actual);changed.inputs['node_modules/@jitl/quickjs-wasmfile-debug-sync/dist/index.js']={bytes:1,imports:[]};
    assert.throws(()=>assertQuickJSBundleMetadata(changed));
  });
  test(`${name}: an external QuickJS runtime import fails closed`,()=>{
    const changed=clone(actual);const output=Object.values(changed.outputs)[0];
    output.imports.push({path:'quickjs-emscripten-core',external:true,kind:'require-call'});
    assert.throws(()=>assertQuickJSBundleMetadata(changed));
  });
}
test('only the reviewed unused literal changes',()=>{
  const changed=stripUnusedQuickJSWasm(source);
  assert.equal(Buffer.byteLength(source)-Buffer.byteLength(changed),819609);
  assert.ok(changed.includes('instantiateWasm'));assert.ok(changed.includes('importFFI'));assert.ok(changed.includes('importModuleLoader'));
});
for(const [name,changed] of [['missing marker',source.replace('\\0asm','not-wasm')],['duplicate source',source+source],['source drift',source+'\n// changed\n']]) {
  test(`source guard rejects ${name}`,()=>assert.throws(()=>stripUnusedQuickJSWasm(changed)));
}
test('missing metadata is a failure',()=>assert.throws(()=>assertQuickJSBundleMetadata(undefined)));

const temporary=mkdtempSync(join(tmpdir(),'quickjs-bundle-contract-'));
try {
  const entry=join(temporary,'entry.mjs');
  writeFileSync(entry,`
import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten';
import imported from ${JSON.stringify(retainedEntry)};
import custom from ${JSON.stringify(join(root,'lib/coding/quickjs-variant.ts'))};
import payload from ${JSON.stringify(join(root,'lib/coding/vendor/quickjs-node24.cjs'))};
const base=imported.default??imported;
export const retainedPayload=payload;
export const withCustomHook=()=>newQuickJSWASMModuleFromVariant(custom);
export const withoutCustomHook=()=>newQuickJSWASMModuleFromVariant(base);
`);
  // Resolve fixture bare imports from the real project dependency tree while
  // retaining actual normal SDK/variant/payload files in build metadata.
  // Entry lives outside root; nodePaths points only at the existing project
  // modules. No package is installed or copied. The helper handles SDK imports.
  const options={entryPoints:[entry],outfile:join(temporary,'fixture.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',packages:'external',metafile:true,logLevel:'silent',nodePaths:[join(root,'node_modules')]};
  // These negative builds deliberately bypass one mechanism at a time. The
  // guard must reject them; write:false cannot overwrite canonical artifacts.
  await test('restoring the registry instead of the core alias is rejected',async()=>{
    const bypass={name:'bypass-core-alias',setup(build){build.onResolve({filter:/^quickjs-emscripten$/},()=>({path:sdkEntry,external:false}));}};
    await assert.rejects(build({...options,write:false,plugins:[bypass,pinnedQuickJSBundle()]}));
  });
  await test('retaining the upstream fallback instead of stripping is rejected',async()=>{
    const bypass={name:'bypass-strip',setup(build){build.onLoad({filter:/[/\\]quickjs-singlefile-cjs-release-sync[/\\]dist[/\\]index\.js$/},()=>({contents:source,loader:'js',resolveDir:dirname(retainedEntry)}));}};
    await assert.rejects(build({...options,write:false,plugins:[bypass,pinnedQuickJSBundle()]}));
  });
  // Keep the temporary tree through the asynchronous node:test callbacks.
  await build({...options,plugins:[pinnedQuickJSBundle()]});
  const probe=join(temporary,'probe.cjs');
  writeFileSync(probe,`
const mode=process.argv[2], api=require('./fixture.cjs');
const failed=error=>{
 if(mode==='without'&&(error instanceof WebAssembly.CompileError||error instanceof WebAssembly.RuntimeError)){console.log('EXPECTED missing custom hook refuses empty fallback');process.exit(0);}
 console.error('Unexpected QuickJS hook probe failure');process.exit(1);
};
process.on('unhandledRejection',failed);
(async()=>{
 const engine=await(mode==='with'?api.withCustomHook():api.withoutCustomHook());
 if(mode==='without'){console.error('Unexpected upstream fallback success');process.exit(2);}
 const vm=engine.newContext(), answer=vm.evalCode('1+1');
 if(answer.error||vm.getNumber(answer.value)!==2)throw Error('custom hook probe failed');
 answer.value.dispose();vm.dispose();console.log('PASS real custom hook instantiation');
})().catch(failed);
`);
  for(const mode of ['with','without']) {
    const result=spawnSync(process.execPath,['--no-experimental-require-module',probe,mode],{cwd:temporary,env:{NODE_ENV:'development',TZ:'UTC'},encoding:'utf8',timeout:30_000,maxBuffer:1024*1024});
    test(`real hook probe ${mode} finishes with its expected outcome`,()=>{
      assert.equal(result.status,0,result.error?.message??result.stderr);
      assert.match(result.stdout,mode==='with'?/PASS real custom hook instantiation/:/EXPECTED missing custom hook refuses empty fallback/);
    });
  }
} finally {
  // Node test bodies referencing temporary output above have already awaited
  // their build promises. Metadata/string assertions use only captured values.
  rmSync(temporary,{recursive:true,force:true});
}
