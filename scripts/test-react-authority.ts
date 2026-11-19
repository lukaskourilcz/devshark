import assert from 'node:assert/strict';
import { runReactSuite } from '../lib/coding/react-runner';
import { guestResultLine, readGuestResult, serializeGuestResult } from '../lib/coding/react-guest';
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS } from '../shared/coding-evaluate';
import { reactSpreadContracts } from './react-spread-contract';
import { runInNewContext } from 'node:vm';
import { lockDownRealm } from '../lib/coding/realm-lockdown';
import { reactRecordContracts } from './react-record-contract';

await reactSpreadContracts();
await reactRecordContracts();

const suite=`import React from 'react';
import {render} from '@testing-library/react';
import App from './App';
test('trusted DOM observation',()=>{const {container}=render(<App/>);expect(container.textContent).toBe('correct');});
test('trusted synchronous assertion',()=>{render(<App/>);expect(['wrong'].every(value=>value==='correct')).toBe(true);});
test('trusted asynchronous assertion',async()=>{render(<App/>);await Promise.resolve();expect('wrong'.includes('correct')).toBe(true);});`;
const attempts=[
  `try { Array.prototype.every=()=>true; String.prototype.includes=()=>true; } catch {}`,
  `try { Object.defineProperty(Object.getPrototypeOf(document.body),'textContent',{get:()=> 'correct'}); } catch {}`,
  `for(const symbol of Object.getOwnPropertySymbols(document.body)) {try {document.body[symbol]._textContent='correct';}catch{}}`,
  `try { Promise.prototype.then=function(resolve){resolve();return this;}; } catch {}`,
  `try { React.useState=()=>[true,()=>{}]; } catch {}`,
  `try { const owner=React.createElement('p')._owner; owner.stateNode.expect=()=>({toBe(){}}); } catch {}`,
  `try { window.document.defaultView.expect=()=>({toBe(){}}); } catch {}`,
  `try { require('@testing-library/react').configure({asyncWrapper:async()=>undefined}); } catch {}`,
  `try { document.createElement.constructor('return process')().stdout.write('passed'); } catch {}`,
];
for(const attack of attempts) {
  const result=await runReactSuite({suite,appSource:`import React from 'react';${attack}\nexport default function App(){return <p>wrong</p>;}`});
  assert.equal(result.compileError,null,attack);
  assert.deepEqual(result.cases.map(one=>one.status),['fail','fail','fail'],attack);
}
const privateDOM=await runReactSuite({suite:`import {inspect} from './App';test('DOM capabilities expose no implementation, realm or prototype',()=>{expect(inspect()).toEqual({symbols:0,implementation:'undefined',realm:'undefined',owner:'undefined',testing:'blocked'});});`,appSource:`import React from 'react';export function inspect(){let testing='blocked';try{require('@testing-library/react');testing='reached';}catch{}return {symbols:Object.getOwnPropertySymbols(document.body).length,implementation:typeof document.body._impl,realm:typeof document.defaultView,owner:typeof React.createElement('div')._owner,testing};}export default function App(){return null;}`});
assert.equal(privateDOM.compileError,null);assert.equal(privateDOM.failed,0,JSON.stringify(privateDOM));
const rejection=await runReactSuite({suite:`import React from 'react';import {render} from '@testing-library/react';import App from './App';test('downlevelled detached async rejection remains observable',async()=>{const seen=[];const listener=event=>{seen.push(event.reason.message);event.preventDefault();};window.addEventListener('unhandledrejection',listener);try{render(<App/>);await new Promise(resolve=>setTimeout(resolve,20));}finally{window.removeEventListener('unhandledrejection',listener);}expect(seen).toEqual(['detached']);});`,appSource:`import React,{useEffect} from 'react';export default function App(){useEffect(()=>{void(async()=>{await Promise.resolve();throw new Error('detached');})();},[]);return null;}`});
assert.equal(rejection.compileError,null);assert.equal(rejection.failed,0,JSON.stringify(rejection));
const classes=await runReactSuite({suite:`import React from 'react';import{render,fireEvent}from'@testing-library/react';import App from './App';test('class state and callbacks remain supported',()=>{const{container}=render(<App/>);expect(container.textContent).toContain('0');fireEvent.click(container.querySelector('button'));fireEvent.click(container.querySelector('button'));expect(container.querySelector('p').textContent).toBe('2');expect(container.querySelector('span').textContent).toBe('2');});`,appSource:`import React from 'react';export default class App extends React.Component{constructor(props){super(props);this.state={count:0};this.last=0;}add(){this.setState(state=>({count:state.count+1}),function(){this.last=this.state.count;this.forceUpdate();});}render(){return <main><p>{this.state.count}</p><span>{this.last}</span><button onClick={()=>this.add()}>Add</button></main>;}}`});
assert.equal(classes.compileError,null,JSON.stringify(classes));assert.equal(classes.failed,0,JSON.stringify(classes));

// IME confirmation is a native keyboard-event flag. A correct handler must
// see it through nativeEvent and a native listener, without gaining write
// access to the host event or any grading capability.
const compositionSuite = `import React from 'react';
import {render,fireEvent,within} from '@testing-library/react';
import App from './App';
test('composing Enter stays pending and a normal Enter commits',()=>{
  const view=render(<App/>),q=within(view.container),input=q.getByLabelText('Draft');
  fireEvent.change(input,{target:{value:'日本語'}});
  expect(fireEvent.keyDown(input,{key:'Enter',isComposing:true})).toBe(true);
  expect(input.value).toBe('日本語');expect(q.getByLabelText('Committed').textContent).toBe('0');
  expect(fireEvent.keyDown(input,{key:'Enter',isComposing:false})).toBe(false);
  expect(input.value).toBe('');expect(q.getByLabelText('Committed').textContent).toBe('1');
});
test('native listeners observe the same read-only composition flag',()=>{
  const view=render(<App/>),q=within(view.container);
  const composing=new KeyboardEvent('keydown',{key:'x',bubbles:true,cancelable:true,isComposing:true});
  fireEvent(window,composing);expect(composing.isComposing).toBe(true);
  expect(q.getByLabelText('Native flag').textContent).toBe('true');
  fireEvent.keyDown(window,{key:'x',isComposing:false});
  expect(q.getByLabelText('Native flag').textContent).toBe('false');
});`;
const compositionApp = `import React,{useEffect,useState} from 'react';
export default function App(){
  const[value,setValue]=useState(''),[committed,setCommitted]=useState(0),[flag,setFlag]=useState('unset');
  useEffect(()=>{const listener=event=>{try{event.isComposing=false;}catch{}setFlag(String(event.isComposing));};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
  return <main><label>Draft<input value={value} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();setCommitted(n=>n+1);setValue('');}}}/></label><output aria-label="Committed">{committed}</output><output aria-label="Native flag">{flag}</output></main>;
}`;
const composition=await runReactSuite({suite:compositionSuite,appSource:compositionApp});
assert.equal(composition.compileError,null,JSON.stringify(composition));
assert.deepEqual(composition.cases.map(one=>one.status),['pass','pass'],JSON.stringify(composition));
const prematureComposition=await runReactSuite({suite:compositionSuite,appSource:compositionApp.replace('if(event.nativeEvent.isComposing)return;','')});
assert.equal(prematureComposition.compileError,null,JSON.stringify(prematureComposition));
assert.deepEqual(prematureComposition.cases.map(one=>one.status),['fail','pass'],JSON.stringify(prematureComposition));

// Error text a component produces is cut before it reaches the verdict. A
// failed `toBe` on 300 000 rendered characters, or a message thrown that
// long, made the verdict line too long for the API to read, and the learner's
// own mistake was answered as a grader outage.
const longSuite=`import React from 'react';import {render} from '@testing-library/react';import App from './App';test('shows the word',()=>{const {container}=render(<App/>);expect(container.textContent).toBe('word');});`;
for(const appSource of [
  `export default function App(){return <p>{'w'.repeat(300000)}</p>;}`,
  `throw new Error('q'.repeat(300000));export default function App(){return null;}`,
  `export default function App(){throw new Error('r'.repeat(300000));}`,
]) {
  const result=await runReactSuite({suite:longSuite,appSource});
  assert.equal(result.failed,1,appSource);
  for(const text of [result.compileError,...result.cases.map(one=>one.error)]) assert.ok((text??'').length<=MAX_LOG_LINE_CHARS+LOG_LINE_CUT.length,`${appSource}: ${(text??'').length} characters`);
  const nonce='a'.repeat(48);
  assert.equal(readGuestResult(guestResultLine(nonce,serializeGuestResult(result)),nonce,longSuite).failed,1,appSource);
}

console.log('PASS React authority: DOM, intrinsics, modules, elements, synchronous/async assertions, detached rejections and long error text');

// F11-10: a disposal abort must not replace a real recursion verdict or poison
// the cached wasm used by the next learner. These tests use the actual engine.
{
  const renders = `import React from 'react';import {render} from '@testing-library/react';import App from './App';
test('renders the learner',()=>{render(<App/>);});
test('later trusted case still reports',()=>{expect(2+2).toBe(4);});`;
  const recurse = `function recurse(){return recurse()+1;}`;
  const cleanRun = async (after: string) => {
    const result = await runReactSuite({
      appSource: 'export default function App(){return <p>ready after recursion</p>;}',
      suite: `import React from 'react';import {render} from '@testing-library/react';import App from './App';test('new learner works',()=>{const view=render(<App/>);expect(view.container.textContent).toBe('ready after recursion');});`,
    });
    assert.equal(result.compileError, null, after);
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(result.passed, 1, after);
  };
  for (const [name, appSource] of [
    ['render recursion', `${recurse}export default function App(){recurse();return null;}`],
    ['module recursion', `${recurse}recurse();export default function App(){return null;}`],
  ]) {
    const result = await runReactSuite({ appSource, suite: renders });
    const text = JSON.stringify(result);
    assert.doesNotMatch(text, /Aborted|gc_obj_list|Lifetime not alive/, `${name}: engine disposal internals do not replace the original failure`);
    assert.equal(result.timedOut, false, `${name}: stack exhaustion is not an interrupt`);
    if (name === 'render recursion') {
      assert.equal(result.compileError, null);
      assert.deepEqual(result.cases.map((one) => one.status), ['fail', 'pass'], text);
      assert.match(result.cases[0].error ?? '', /stack overflow/i);
    } else {
      assert.match(result.compileError ?? '', /stack overflow|maximum call stack size exceeded/i);
    }
    await cleanRun(name);
  }
  // Ordinary learner text with engine-looking words is still ordinary text.
  // This change must not add another message-based error classifier.
  const forged = 'learner Aborted gc_obj_list stack overflow marker';
  const top = await runReactSuite({ appSource: `throw new Error(${JSON.stringify(forged)});export default function App(){return null;}`, suite: renders });
  assert.equal(top.compileError, `compiling App: ${forged}`);
  assert.equal(top.timedOut, false);
  const rendered = await runReactSuite({ appSource: `export default function App(){throw new Error(${JSON.stringify(forged)});}`, suite: renders });
  assert.equal(rendered.compileError, null);
  assert.deepEqual(rendered.cases.map((one) => one.status), ['fail', 'pass']);
  assert.match(rendered.cases[0].error ?? '', /learner Aborted gc_obj_list stack overflow marker/);
  assert.equal(rendered.timedOut, false);
  await cleanRun('ordinary engine-looking error text');
}
console.log('PASS React authority: quiet disposal preserves recursion failures and the next learner grades');


// What the learner's code throws reaches the verdict through the sandbox's
// guarded dump (lib/coding/sandbox.ts): a thrown string reads as itself, not
// as an empty "compiling App: " or "Learner engine failed"; a thrown promise
// or an error whose message getter throws still gives a verdict; and a long
// message is cut where it leaves the engine.
{
  const renders=`import React from 'react';import {render} from '@testing-library/react';import App from './App';test('renders',()=>{render(<App/>);});`;
  const top=await runReactSuite({suite:renders,appSource:`import React from 'react';throw 'top-level oops';\nexport default function App(){return null;}`});
  assert.equal(top.compileError,'compiling App: top-level oops','a thrown string at the top level is the compile error');
  const rendered=await runReactSuite({suite:renders,appSource:`import React from 'react';export default function App(){throw 'render oops';}`});
  assert.equal(rendered.failed,1);
  assert.match(rendered.cases[0].error??'',/render oops/,'a thrown string while rendering is the case error');
  for(const attack of [`throw (async()=>{})();`,`const e=new Error('a');Object.defineProperty(e,'message',{get(){throw e;}});throw e;`,`throw {get message(){throw new Error('boom');},get name(){throw 1;}};`]) {
    for(const appSource of [`import React from 'react';${attack}\nexport default function App(){return null;}`,`import React from 'react';export default function App(){${attack}}`]) {
      const result=await runReactSuite({suite:renders,appSource});
      assert.ok(result.compileError!==null||result.failed===1,`${appSource}: a hostile thrown value fails the run, not the grader`);
      assert.doesNotMatch(JSON.stringify(result),/Lifetime not alive|QuickJSUseAfterFree/,appSource);
    }
  }
  const flood=await runReactSuite({suite:renders,appSource:`import React from 'react';export default function App(){throw new Error('x'.repeat(5e6));}`});
  assert.ok((flood.cases[0].error??'').length<=MAX_LOG_LINE_CHARS+LOG_LINE_CUT.length,'a five-megabyte message is cut');
}
console.log('PASS React authority: thrown strings, promises and hostile errors reach the verdict through the guarded dump');

// The learner engine's globals and the keys of every capability it hands
// learner code (lib/coding/react-learner.ts: the read lists and the globals
// it encodes). A name added there fails here until it is listed, so each new
// way out of the engine is a reviewed change. jsdom's window has
// XMLHttpRequest and WebSocket; the window capability shows neither, and its
// fetch reads undefined because jsdom has none (the global fetch is the
// fixture guard). Before the lockdown below, which freezes this process.
{
  const split = (names: string) => names.split(' ');
  const engineBuiltIns = split('AggregateError Array ArrayBuffer BigInt BigInt64Array BigUint64Array Boolean DataView Date Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array Function Infinity Int16Array Int32Array Int8Array InternalError Iterator JSON Map Math NaN Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String Symbol SyntaxError TypeError URIError Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet console decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval globalThis isFinite isNaN parseFloat parseInt queueMicrotask undefined unescape');
  const hostGlobals = split('AbortController DOMException Element HTMLElement HTMLInputElement Headers Intl Node URL URLSearchParams cancelAnimationFrame clearInterval clearTimeout crypto document fetch localStorage performance requestAnimationFrame setInterval setTimeout window');
  const web = split('signal aborted reason abort throwIfAborted addEventListener removeEventListener ok status statusText headers url json text clone get set append delete has keys values entries toString href search searchParams pathname origin');
  const pinned: Record<string, unknown> = {
    globals: [...engineBuiltIns, ...hostGlobals].sort(),
    window: split('document console innerWidth innerHeight localStorage sessionStorage location addEventListener removeEventListener dispatchEvent getComputedStyle matchMedia requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval fetch'),
    document: split('activeElement body documentElement title querySelector querySelectorAll getElementById createElement addEventListener removeEventListener'),
    element: split('nodeType nodeName tagName textContent innerHTML value checked disabled id name type title tabIndex selectionStart selectionEnd parentElement parentNode children childNodes firstChild lastChild nextSibling previousSibling ownerDocument dataset style className classList isConnected contains focus blur select setSelectionRange getAttribute setAttribute removeAttribute hasAttribute querySelector querySelectorAll appendChild removeChild addEventListener removeEventListener getBoundingClientRect click closest matches'),
    event: split('type target currentTarget relatedTarget key code keyCode which isComposing button buttons clientX clientY shiftKey ctrlKey altKey metaKey defaultPrevented preventDefault stopPropagation persist nativeEvent'),
    storage: split('getItem setItem removeItem clear key length'),
    // URL, URLSearchParams, AbortController, AbortSignal and Headers share one read list.
    web: [web, web, web, web, web],
    intl: split('DateTimeFormat NumberFormat Collator PluralRules RelativeTimeFormat ListFormat DisplayNames'),
    crypto: ['randomUUID'],
    performance: ['now'],
    react: split('Children Component Fragment PureComponent cloneElement createContext createElement forwardRef isValidElement memo startTransition use useActionState useCallback useContext useDeferredValue useEffect useId useImperativeHandle useInsertionEffect useLayoutEffect useMemo useOptimistic useReducer useRef useState useSyncExternalStore useTransition version'),
    // Neither the network nor Node: no XMLHttpRequest, WebSocket, EventSource,
    // worker, navigator, require, process or WebAssembly, bare or on window.
    unreachable: 'undefined '.repeat(26).trim(),
    unreachableOnWindow: 'undefined '.repeat(17).trim(),
    generated: ['TypeError: Dynamic code generation is disabled', 'TypeError: Dynamic code generation is disabled', 'TypeError: Dynamic code generation is disabled'],
  };
  const appSource = `import React from 'react';
const seen = {};
const kinds = (target, names) => names.map((name) => typeof target[name]).join(' ');
const refused = (run) => { try { run(); return 'ran'; } catch (error) { return error.name + ': ' + error.message; } };
export function probe() {
  const controller = new AbortController();
  return JSON.stringify({
    globals: Object.getOwnPropertyNames(globalThis).sort(),
    window: Object.keys(window), document: Object.keys(document), element: Object.keys(document.body), event: seen.event,
    storage: Object.keys(localStorage),
    web: [new URL('https://a.b/?q=1'), new URLSearchParams('q=1'), controller, controller.signal, new Headers()].map((value) => Object.keys(value)),
    intl: Object.keys(Intl), crypto: Object.keys(crypto), performance: Object.keys(performance), react: Object.keys(React).sort(),
    unreachable: kinds(globalThis, ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'navigator', 'require', 'process', 'module', 'importScripts', 'WebAssembly', 'Atomics', 'Buffer', 'global', 'postMessage', 'BroadcastChannel', 'Request', 'Response', 'indexedDB', 'caches', 'sessionStorage', 'open', 'print', 'std', 'os', 'scriptArgs']),
    unreachableOnWindow: kinds(window, ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'navigator', 'process', 'require', 'fetch', 'open', 'postMessage', 'top', 'parent', 'frames', 'self', 'opener', 'eval', 'Function']),
    generated: [() => eval('1'), () => Function('return 1')(), () => (() => {}).constructor('return 1')()].map(refused),
  });
}
export default function App() { return <button onClick={(event) => { seen.event = Object.keys(event); }}>probe</button>; }`;
  const suite = `import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import App, { probe } from './App';
const pinned = ${JSON.stringify(pinned)};
let seen = null;
test('probe', () => { const { container } = render(<App />); fireEvent.click(container.querySelector('button')); seen = JSON.parse(probe()); });
for (const name of Object.keys(pinned)) test(name, () => { expect(seen[name]).toEqual(pinned[name]); });`;
  const listed = await runReactSuite({ suite, appSource });
  assert.equal(listed.compileError, null, JSON.stringify(listed));
  assert.deepEqual(listed.cases.map((one) => one.name), ['probe', ...Object.keys(pinned)]);
  for (const one of listed.cases) assert.equal(one.status, 'pass', `${one.name}: ${one.error}`);
  console.log(`PASS React authority: the learner engine has ${(pinned.globals as string[]).length} globals, ${hostGlobals.length} of them from the host, and pinned capability keys; no network or Node name is reachable`);
}

// The guest freezes every standard built-in before learner code runs
// (lib/coding/realm-lockdown.ts). The list is checked against the names a
// fresh realm of this Node has: SuppressedError, DisposableStack and
// AsyncDisposableStack arrived with Node 24 and were left writable. Last in
// this file, because it freezes this process.
lockDownRealm();
const notBuiltIns=new Set(['Infinity','NaN','undefined','globalThis','eval','console','WebAssembly']);
const realmNames=(runInNewContext('Object.getOwnPropertyNames(globalThis)') as string[]).filter(name=>!notBuiltIns.has(name));
assert.ok(realmNames.includes('Object')&&realmNames.length>50,'the fresh realm lists its built-ins');
for(const name of realmNames) {
  const value=(globalThis as Record<string,unknown>)[name] as {prototype?:unknown}|undefined;
  assert.ok(value!==undefined,`${name} exists here`);
  assert.ok(Object.isFrozen(value)||value===Error,`${name} is frozen`);
  if(value.prototype&&typeof value.prototype==='object') assert.ok(Object.isFrozen(value.prototype),`${name}.prototype is frozen`);
}
console.log(`PASS React authority: realm lockdown freezes all ${realmNames.length} built-ins of this Node`);
