import { newQuickJSWASMModuleFromVariant, type QuickJSHandle } from 'quickjs-emscripten';
import variant from './quickjs-variant';
import { types } from 'node:util';
import type { Context } from 'node:vm';
import { REACT_PROMISE_SOURCE } from './react-promise-source';
import { UTC_TIME_SOURCE } from '../../shared/coding-utc-time';
import { cutErrorText } from '../../shared/coding-error-text';
import { dumpThrown } from './vm-errors';

// Only serialized values cross the WASM boundary. React, the DOM, the suite,
// matchers and verdict never enter the learner engine as JavaScript objects.
type Wire = null | string | number | boolean | { u: 1 } | { num: string } | { big: string } | { g: number; kind: string } | { h: number; kind: string } | { list: Wire[] };
type HostCapability = { value: any; get: Set<string>; set: Set<string>; bound: boolean; invoke?: (...args: any[]) => any; record?: Set<string> };

/** A value the engine threw, as the grader's sandbox reads one: a thrown
 * string is its own text, an error is its message, and anything else (a
 * promise, an error whose message getter throws) is `fallback`. Cut like a
 * console line, so a five-megabyte message does not leave the engine whole. */
function thrownText(detail: unknown, fallback: string): string {
  const message = typeof detail === 'string' ? detail
    : detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string' ? (detail as { message: string }).message : '';
  return cutErrorText(message || fallback);
}
const thrownField = (detail: unknown, key: 'name' | 'stack'): string | undefined => {
  const value = detail && typeof detail === 'object' ? (detail as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && value ? cutErrorText(value) : undefined;
};

const publicRecordKey = (key: string): boolean => !key.startsWith('_') && !['constructor', 'prototype'].includes(key);

/** Only ordinary data chains qualify, never a class/DOM/host prototype. Read
 * descriptors without invoking getters; inherited callable values stay opaque.
 * Null-prototype records and the Object prototype of another VM are supported. */
function ordinaryRecord(value: object): { keys: string[]; read: string[]; write: string[] } | null {
  const keys = new Set<string>(), read: string[] = [], seen = new Set<string>();
  let cursor: object | null = value;
  for (let depth = 0; cursor !== null; depth++) {
    if (depth > 32 || types.isProxy(cursor)) return null;
    const constructor = Object.getOwnPropertyDescriptor(cursor, 'constructor');
    if (typeof constructor?.value === 'function' && constructor.value.prototype === cursor) {
      const intrinsicObject = Object.getPrototypeOf(cursor) === null && constructor.value.name === 'Object' &&
        /\[native code\]/.test(Function.prototype.toString.call(constructor.value));
      if (!intrinsicObject) return null;
      break;
    }
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (!publicRecordKey(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(cursor, key)!;
      keys.add(key);
      if ('value' in descriptor && (cursor === value || typeof descriptor.value !== 'function')) read.push(key);
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  const current = Object.getOwnPropertyDescriptor(value, 'current');
  return { keys: [...keys], read, write: current && 'value' in current && current.writable ? ['current'] : [] };
}

function recordProperty(value: object, key: string): PropertyDescriptor | undefined {
  let cursor: object | null = value;
  for (let depth = 0; cursor !== null && depth <= 32; depth++, cursor = Object.getPrototypeOf(cursor)) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}
const REACT_EXPORTS = ['createElement','cloneElement','isValidElement','Fragment','Children','createContext','useContext','useState','useReducer','useEffect','useLayoutEffect','useInsertionEffect','useMemo','useCallback','useRef','useId','useSyncExternalStore','useTransition','useDeferredValue','useImperativeHandle','forwardRef','memo','startTransition','use','useActionState','useOptimistic','version'];
const DOM_READ = ['nodeType','nodeName','tagName','textContent','innerHTML','value','checked','disabled','id','name','type','title','tabIndex','selectionStart','selectionEnd','parentElement','parentNode','children','childNodes','firstChild','lastChild','nextSibling','previousSibling','ownerDocument','dataset','style','className','classList','isConnected','contains','focus','blur','select','setSelectionRange','getAttribute','setAttribute','removeAttribute','hasAttribute','querySelector','querySelectorAll','appendChild','removeChild','addEventListener','removeEventListener','getBoundingClientRect','click','closest','matches'];
const DOM_WRITE = ['textContent','innerHTML','value','checked','disabled','title','tabIndex','className','indeterminate'];
const EVENT_READ = ['type','target','currentTarget','relatedTarget','key','code','keyCode','which','isComposing','button','buttons','clientX','clientY','shiftKey','ctrlKey','altKey','metaKey','defaultPrevented','preventDefault','stopPropagation','persist','nativeEvent'];
const WEB_READ = ['signal','aborted','reason','abort','throwIfAborted','addEventListener','removeEventListener','ok','status','statusText','headers','url','json','text','clone','get','set','append','delete','has','keys','values','entries','toString','href','search','searchParams','pathname','origin'];
const WINDOW_READ = ['document','console','innerWidth','innerHeight','localStorage','sessionStorage','location','addEventListener','removeEventListener','dispatchEvent','getComputedStyle','matchMedia','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval','fetch'];
const DOCUMENT_READ = ['activeElement','body','documentElement','title','querySelector','querySelectorAll','getElementById','createElement','addEventListener','removeEventListener'];

const BOOTSTRAP = String.raw`(request, schedule, report, roots) => {
  'use strict';
  const kernel = (${REACT_PROMISE_SOURCE})(schedule, (type,promise,reason) => report(type,encode(reason)));
  const Promise = kernel.Promise;
  const guests = new Map(), ids = new WeakMap(), hosts = new Map(), hostIds = new WeakMap(), instanceUpdaters=new WeakMap();
  let Component;
  let next = 1;
  const encode = value => {
    if (value === undefined) return {u:1};
    if(typeof value==='number'&&!Number.isFinite(value)) return {num:String(value)};
    if(typeof value==='bigint') return {big:String(value)};
    if (value === null || ['string','number','boolean'].includes(typeof value)) return value;
    const host = hostIds.get(value); if (host) return host;
    let id = ids.get(value); if (!id) { id=next++; ids.set(value,id); guests.set(id,value); }
    return {g:id,kind:typeof value==='function'?(value.prototype&&value.prototype.isReactComponent?'class':'function'):Array.isArray(value)?'array':kernel.isPromise(value)?'promise':value instanceof Error?'error':value instanceof Date?'date':value instanceof Set?'set':value instanceof Map?'map':'object'};
  };
  const rpc = message => {
    const result = JSON.parse(request(JSON.stringify(message)));
    if (result.error) { const error=new Error(result.error.message); error.name=result.error.name; throw error; }
    return decode(result.value);
  };
  const decode = value => {
    if (value === null || typeof value !== 'object') return value;
    if (value.u) return undefined;
    if(value.num) return Number(value.num);
    if(value.big) return BigInt(value.big);
    if (value.list) return value.list.map(decode);
    if (value.g) return guests.get(value.g);
    if (!value.h) throw new Error('Invalid capability');
    if (hosts.has(value.h)) return hosts.get(value.h);
    let target;
    if (value.kind==='promise') {
      const deferred=kernel.deferred(); hosts.set(value.h,deferred.promise); hostIds.set(deferred.promise,value);
      rpc({op:'subscribe',id:value.h,yes:encode(deferred.resolve),no:encode(deferred.reject)});
      return deferred.promise;
    }
    if (value.kind==='function') target=function(...args){return rpc({op:'call',id:value.h,args:args.map(encode)});};
    else target=value.kind==='array'?[]:{};
    const proxy=new Proxy(target,{
      get(target,key,receiver){
        if (typeof key==='symbol') return Reflect.get(target,key,receiver);
        if (value.kind==='array'&&key!=='length'&&typeof key==='string'&&!/^(?:0|[1-9][0-9]*)$/.test(key)&&key in Array.prototype) return Reflect.get(target,key,receiver);
        if (value.kind!=='array'&&Object.prototype.hasOwnProperty.call(target,key)) return Reflect.get(target,key,receiver);
        if (key==='then') return undefined;
        if (key==='constructor'||key==='__proto__'||key==='prototype') return Reflect.get(target,key,receiver);
        if (value.kind==='function'&&['call','apply','bind','name','length'].includes(key)) return Reflect.get(target,key,receiver);
        return rpc({op:'get',id:value.h,key});
      },
      set(target,key,next){if(typeof key!=='string') return false; rpc({op:'set',id:value.h,key,value:encode(next)}); return true;},
      has(target,key){return Reflect.has(target,key)||(typeof key==='string'&&rpc({op:'has',id:value.h,key}));},
      ownKeys(target){return [...new Set([...Reflect.ownKeys(target),...rpc({op:'keys',id:value.h})])];},
      getOwnPropertyDescriptor(target,key){const descriptor=Reflect.getOwnPropertyDescriptor(target,key); if(descriptor&&!descriptor.configurable) return descriptor; if(typeof key==='string'){const own=rpc({op:'descriptor',id:value.h,key});if(own)return own[1]?{value:rpc({op:'get',id:value.h,key}),writable:false,enumerable:own[0],configurable:true}:{get:undefined,set:undefined,enumerable:own[0],configurable:true};} return descriptor;},
      defineProperty(){throw new TypeError('Host capabilities cannot be redefined');},
      setPrototypeOf(){throw new TypeError('Host capabilities cannot be redefined');}
    });
    hosts.set(value.h,proxy); hostIds.set(proxy,value); return proxy;
  };
  const modules=Object.create(null);
  for(const [name,value] of Object.entries(roots.modules)) modules[name]=decode(value);
  Component=class Component {
    constructor(props,context){this.props=props;this.context=context;this.refs={};}
    setState(update,callback){const updater=instanceUpdaters.get(this);if(!updater)throw new Error('Component is not mounted');updater('state',update,callback);}
    forceUpdate(callback){const updater=instanceUpdaters.get(this);if(!updater)throw new Error('Component is not mounted');updater('force',undefined,callback);}
  };
  Component.prototype.isReactComponent={};
  class PureComponent extends Component {}
  PureComponent.prototype.isPureReactComponent=true;
  modules.react=Object.assign({},modules.react,{Component,PureComponent});
  const require=name=>{if(Object.prototype.hasOwnProperty.call(modules,name)) return modules[name]; throw new Error("Cannot find module '"+name+"'");};
  for(const [name,value] of Object.entries(roots.globals)) Object.defineProperty(globalThis,name,{value:decode(value),writable:name==='fetch',configurable:false});
  const now=decode(roots.now);
  const utcDate=(${UTC_TIME_SOURCE})(Date,{inPlace:true});
  Object.defineProperty(globalThis,'Date',{value:utcDate,writable:false,configurable:false});
  Object.defineProperty(Date,'now',{value:now,writable:false,configurable:false});
  const locale=decode(roots.locale);
  for(const [method,type] of [['toLocaleString','string'],['toLocaleDateString','date'],['toLocaleTimeString','time']]) Object.defineProperty(Date.prototype,method,{value:function(locales,options){return locale(type,this.getTime(),locales,options);},writable:false,configurable:false});
  for(const [name,check] of Object.entries(roots.nodeTypes)) {
    const constructor=function(){throw new TypeError('Illegal constructor');};
    Object.defineProperty(constructor,Symbol.hasInstance,{value:value=>decode(check)(value)});
    Object.defineProperty(globalThis,name,{value:constructor,writable:false,configurable:false});
  }
  Object.defineProperty(globalThis,'Promise',{value:Promise,writable:false,configurable:false});
  Object.defineProperty(globalThis,'queueMicrotask',{value:kernel.queueMicrotask,writable:false,configurable:false});
  Object.defineProperty(globalThis,'console',{value:Object.freeze({log(){},warn(){},error(){},info(){},debug(){}}),writable:false,configurable:false});
  const disabled=()=>{throw new TypeError('Dynamic code generation is disabled');};
  Object.defineProperty(Function.prototype,'constructor',{value:disabled,writable:false,configurable:false});
  for(const prototype of [Object.getPrototypeOf(function*(){}),Object.getPrototypeOf(async function(){}),Object.getPrototypeOf(async function*(){})]) Object.defineProperty(prototype,'constructor',{value:disabled,writable:false,configurable:false});
  Object.defineProperty(globalThis,'eval',{value:disabled,writable:false,configurable:false});
  Object.defineProperty(globalThis,'Function',{value:disabled,writable:false,configurable:false});
  // Protect only bridge/kernel dependencies, not learner-owned data. Error
  // instances retain writable name/message (used by AbortError fixtures).
  for(const root of [Object,Array,String,Number,Boolean,Reflect,JSON,Math,Map,Set,WeakMap,WeakSet,Promise]) { if(root.prototype) Object.freeze(root.prototype); Object.freeze(root); }
  return (message,load) => {
    const data=JSON.parse(message); let result;
    if(data.op==='invoke') result=Reflect.apply(guests.get(data.id),decode(data.thisArg),data.args.map(decode));
    else if(data.op==='read') result=guests.get(data.id)[data.key];
    else if(data.op==='keys') return JSON.stringify(Object.keys(guests.get(data.id)));
    else if(data.op==='write') {guests.get(data.id)[data.key]=decode(data.value);result=true;}
    else if(data.op==='delete') result=delete guests.get(data.id)[data.key];
    else if(data.op==='items') return JSON.stringify(Array.from(guests.get(data.id),encode));
    else if(data.op==='method') result=Reflect.apply(guests.get(data.id)[data.key],guests.get(data.id),data.args.map(decode));
    else if(data.op==='class-init'){result=Reflect.construct(guests.get(data.id),data.args.map(decode));instanceUpdaters.set(result,decode(data.updater));}
    else if(data.op==='class-sync'){const instance=guests.get(data.id);instance.props=decode(data.props);instance.state=decode(data.state);instance.context=decode(data.context);instance.refs=decode(data.refs);result=undefined;}
    else if(data.op==='class-method'){const instance=guests.get(data.id),fn=instance[data.key];result=typeof fn==='function'?Reflect.apply(fn,instance,data.args.map(decode)):undefined;}
    else if(data.op==='subscribe') { kernel.subscribe(guests.get(data.id),decode(data.yes),decode(data.no)); result=undefined; }
    else if(data.op==='module') { const module={exports:{}}; load(require,module,module.exports); modules[data.name]=module.exports; if(data.name==='./fetchStub') modules['./fetchStub.js']=module.exports; result=module.exports; }
    else if(data.op==='flush') { kernel.flush(); result=undefined; }
    else throw new Error('Invalid engine operation');
    return JSON.stringify(encode(result));
  };
}`;

let wasm: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export interface ReactLearner {
  exports: Record<string, unknown>;
  dispose(): void;
}

export async function createReactLearner(input: {
  source: string;
  page: Context;
  modules: Record<string, unknown>;
  fixtures: Record<string,string>;
  report(type: string, reason: unknown): void;
  onInterrupt?(): void;
  makeError(message:string,name:string): Error;
}): Promise<ReactLearner> {
  const loading = wasm ??= newQuickJSWASMModuleFromVariant(variant);
  const engine = await loading;
  const runtime=engine.newRuntime();
  runtime.setMemoryLimit(64*1024*1024); runtime.setMaxStackSize(1024*1024);
  let expires=Date.now()+2500, disposed=false, flushQueued=false, command: QuickJSHandle | undefined;
  let entryDepth=0, interrupted=false;
  let interruption: Error | undefined;
  runtime.setInterruptHandler(()=>{
    if(interrupted) return true;
    if(Date.now()<=expires) return false;
    interrupted=true;
    input.onInterrupt?.();
    return true;
  });
  const enter=<T>(run:()=>T): T => {
    if(interrupted) {
      interruption??=input.makeError('interrupted','InternalError');
      throw interruption;
    }
    if(entryDepth===0) expires=Date.now()+2500;
    entryDepth++;
    try {return run();} finally {entryDepth--;}
  };
  const vm=runtime.newContext();
  const capabilities=new Map<number,HostCapability>(), hostIds=new WeakMap<object,number>(), guestValues=new Map<number,any>(), guestIds=new WeakMap<object,number>();
  const boundMethods=new WeakMap<object,Map<string,{raw:any;wire:Wire}>>();
  const timers=new Map<any,{clear:(timer:any)=>void}>(), listeners: Array<{target:any;name:string;fn:any;options:any}>=[];
  // Disposal can abort a wasm module after real stack exhaustion. Preserve
  // the original run result, attempt every handle and give later learners a
  // fresh module. An older concurrent learner must not clear a newer cache.
  const disposeQuietly=()=>{
    if(disposed) return;
    disposed=true;
    let failed=false;
    for(const [timer,entry] of timers) {try{entry.clear(timer);}catch{failed=true;}}
    for(const {target,name,fn,options} of listeners) {try{target.removeEventListener(name,fn,options);}catch{failed=true;}}
    try{command?.dispose();}catch{failed=true;}
    try{vm.dispose();}catch{failed=true;}
    try{runtime.dispose();}catch{failed=true;}
    if(failed&&wasm===loading) wasm=undefined;
  };
  let next=1;
  const evaluate=(source:string): QuickJSHandle => {
    const result=vm.evalCode(source,'learner.js');
    if(result.error) throw new Error(thrownText(dumpThrown(vm,result.error),'Learner engine failed'));
    return result.value;
  };
  const invoke=(message:Record<string,unknown>): any => {
    if(disposed||!command) throw new Error('Learner engine is closed');
    return enter(()=>{
      const argument=vm.newString(JSON.stringify(message));
      const result=vm.callFunction(command,vm.undefined,argument); argument.dispose();
      if(result.error) { const detail=dumpThrown(vm,result.error); const error=input.makeError(thrownText(detail,'Learner engine failed'),thrownField(detail,'name')||'Error'); const stack=thrownField(detail,'stack'); if(stack) error.stack=stack; throw error; }
      const value=JSON.parse(vm.getString(result.value)); result.value.dispose(); return value;
    });
  };
  const capability=(value:any,get:string[]=[],set:string[]=[],call?: (...args:any[])=>any,kind?:string,bound=false,record?:string[]): Wire => {
    if((typeof value==='object'&&value!==null)||typeof value==='function') {
      const old=hostIds.get(value); if(old) return {h:old,kind:kind||(Array.isArray(value)?'array':types.isPromise(value)?'promise':capabilities.get(old)!.invoke?'function':'object')};
    }
    const id=next++; capabilities.set(id,{value,get:new Set(get),set:new Set(set),invoke:call,bound,...(record?{record:new Set(record)}:{})});
    if((typeof value==='object'&&value!==null)||typeof value==='function') hostIds.set(value,id);
    return {h:id,kind:kind||(call?'function':'object')};
  };
  const encode=(value:any, depth=0): Wire => {
    if(depth>50) throw new Error('Capability value is too deep');
    if(value===undefined) return {u:1};
    if(typeof value==='number'&&!Number.isFinite(value)) return {num:String(value)};
    if(typeof value==='bigint') return {big:String(value)};
    if(value===null||['string','number','boolean'].includes(typeof value)) return value;
    const guest=guestIds.get(value); if(guest) return {g:guest,kind:typeof value==='function'?'function':Array.isArray(value)?'array':'object'};
    if(Array.isArray(value)) return capability(value,Object.keys(value).concat('length'),[],undefined,'array');
    if(types.isPromise(value)) return capability(value,[],[],undefined,'promise');
    if(typeof value==='function') return capability(value,[],[],(...args)=>Reflect.apply(value,undefined,args));
    const record=typeof value==='object'?ordinaryRecord(value):null;
    const read=(key:string)=>record?(record.read.includes(key)?recordProperty(value,key)?.value:undefined):value[key];
    if(value===input.page.window) return capability(value,WINDOW_READ,[],undefined,undefined,true);
    if(value===input.page.document) return capability(value,DOCUMENT_READ,['title'],undefined,undefined,true);
    if(read('$$typeof')) return capability(value,read('Provider')?['Provider','Consumer']:[]);
    if(typeof read('nodeType')==='number') return capability(value,DOM_READ,DOM_WRITE,undefined,undefined,true);
    if(value && typeof read('preventDefault')==='function') return capability(value,EVENT_READ,[],undefined,undefined,true);
    if(value && (typeof read('abort')==='function'||typeof read('aborted')==='boolean'||typeof read('json')==='function'||typeof read('get')==='function'||(input.page.URL&&value instanceof input.page.URL))) return capability(value,WEB_READ,[],undefined,undefined,true);
    if(value && typeof read('getItem')==='function') return capability(value,['getItem','setItem','removeItem','clear','key','length'],[],undefined,undefined,true);
    if(value instanceof Error||types.isNativeError(value)) return capability(value,['name','message','stack']);
    if(typeof read('resolvedOptions')==='function') return capability(value,['format','formatToParts','formatRange','formatRangeToParts','resolvedOptions','compare','select'],[],undefined,undefined,true);
    if(typeof value==='symbol') return capability(value);
    if(record) return capability(value,record.read,record.write,undefined,undefined,false,record.keys);
    if(typeof read('length')==='number'&&read('length')<10000) return {list:Array.from(value,(one:any)=>encode(one,depth+1))};
    return capability(value,[]);
  };
  const decode=(value:Wire): any => {
    if(value===null||typeof value!=='object') return value;
    if('u' in value) return undefined;
    if('num' in value) return Number(value.num);
    if('big' in value) return BigInt(value.big);
    if('list' in value) return value.list.map(decode);
    if('h' in value) { const one=capabilities.get(value.h); if(!one) throw new Error('Unknown capability'); return one.value; }
    if(guestValues.has(value.g)) return guestValues.get(value.g);
    const id=value.g;
    let target:any;
    if(value.kind==='class') {
      const React=input.modules.react as any;
      const instances=new WeakMap<object,number>();
      target=class LearnerComponent extends React.Component {
        constructor(props:any,context:any){
          super(props,context);
          const updater=encode((kind:string,update:any,callback:any)=>kind==='force'?this.forceUpdate(callback):this.setState(update,callback));
          const instance=invoke({op:'class-init',id,args:[encode(props),encode(context)],updater});
          if(!instance.g) throw new Error('Invalid component instance');
          instances.set(this,instance.g);
          guestIds.set(this,instance.g);
          this.state=decode(invoke({op:'read',id:instance.g,key:'state'}))??null;
        }
        render(){
          const instance=instances.get(this)!;
          invoke({op:'class-sync',id:instance,props:encode(this.props),state:encode(this.state),context:encode(this.context),refs:encode(this.refs)});
          return decode(invoke({op:'class-method',id:instance,key:'render',args:[]}));
        }
        componentDidMount(){return decode(invoke({op:'class-method',id:instances.get(this),key:'componentDidMount',args:[]}));}
        componentDidUpdate(props:any,state:any,snapshot:any){return decode(invoke({op:'class-method',id:instances.get(this),key:'componentDidUpdate',args:[encode(props),encode(state),encode(snapshot)]}));}
        componentWillUnmount(){return decode(invoke({op:'class-method',id:instances.get(this),key:'componentWillUnmount',args:[]}));}
        componentDidCatch(error:any,info:any){return decode(invoke({op:'class-method',id:instances.get(this),key:'componentDidCatch',args:[encode(error),encode(info)]}));}
      };
      const prototype=decode(invoke({op:'read',id,key:'prototype'}));
      if(prototype?.isPureReactComponent) target.prototype.isPureReactComponent=true;
      for(const method of ['shouldComponentUpdate','getSnapshotBeforeUpdate','componentWillMount','componentWillReceiveProps','componentWillUpdate','UNSAFE_componentWillMount','UNSAFE_componentWillReceiveProps','UNSAFE_componentWillUpdate']) {
        if(typeof prototype?.[method]!=='function') continue;
        target.prototype[method]=function(this:any,...args:any[]){return decode(invoke({op:'class-method',id:instances.get(this),key:method,args:args.map(arg=>encode(arg))}));};
      }
    }
    else if(value.kind==='function') target=function(this:any,...args:any[]){return decode(invoke({op:'invoke',id,thisArg:encode(this),args:args.map(arg=>encode(arg))}));};
    else if(value.kind==='array') target=[];
    else if(value.kind==='promise') {
      target=new Promise((resolve,reject)=>{
        const yes=encode((result:any)=>resolve(result)),no=encode((error:any)=>reject(error));
        invoke({op:'subscribe',id,yes,no});
      });
      guestValues.set(id,target); guestIds.set(target,id); return target;
    } else if(value.kind==='set'||value.kind==='map') {
      const items=invoke({op:'items',id}).map(decode); target=value.kind==='set'?new Set(items):new Map(items);
      guestValues.set(id,target); guestIds.set(target,id); return target;
    } else if(value.kind==='error') target=input.makeError(decode(invoke({op:'read',id,key:'message'})),decode(invoke({op:'read',id,key:'name'})));
    else if(value.kind==='date') {target=new input.page.Date(decode(invoke({op:'method',id,key:'getTime',args:[]}))); guestValues.set(id,target);guestIds.set(target,id);return target;}
    else target={};
    const proxy=new Proxy(target,{
      get(target,key,receiver){
        if(key===Symbol.iterator&&value.kind==='array') return function*(){const length=decode(invoke({op:'read',id,key:'length'})); for(let index=0;index<length;index++) yield decode(invoke({op:'read',id,key:String(index)}));};
        if(typeof key==='symbol'||key==='then'||key==='__proto__') return Reflect.get(target,key,receiver);
        if((key==='constructor'||key==='prototype')&&!invoke({op:'keys',id}).includes(key)) return Reflect.get(target,key,receiver);
        return decode(invoke({op:'read',id,key}));
      },
      ownKeys(){return value.kind==='array'?[...invoke({op:'keys',id}),'length']:invoke({op:'keys',id});},
      getOwnPropertyDescriptor(target,key){if(key==='length'&&value.kind==='array') return Reflect.getOwnPropertyDescriptor(target,key); if(!invoke({op:'keys',id}).includes(String(key))) return Reflect.getOwnPropertyDescriptor(target,key); return {configurable:true,enumerable:true,writable:false,value:decode(invoke({op:'read',id,key:String(key)}))};},
      set(_target,key,next){if(typeof key!=='string') return false; invoke({op:'write',id,key,value:encode(next)}); return true;},
      deleteProperty(_target,key){return Boolean(invoke({op:'delete',id,key:String(key)}));}
    });
    guestValues.set(id,proxy); guestIds.set(proxy,id); return proxy;
  };
  const callHost=(message:any): Wire => {
    const one=capabilities.get(message.id); if(!one) throw new Error('Unknown capability');
    if(message.op==='keys') return {list:(one.record?Object.getOwnPropertyNames(one.value).filter(key=>one.record!.has(key)):Array.isArray(one.value)?Object.keys(one.value).concat('length'):[...one.get]).map(key=>key)};
    if(message.op==='has') return Boolean(typeof message.key==='string'&&(one.record?one.record.has(message.key)&&recordProperty(one.value,message.key):Array.isArray(one.value)?Object.hasOwn(one.value,message.key):one.get.has(message.key)));
    if(message.op==='descriptor') {
      if(typeof message.key!=='string') return null;
      if(one.record) {
        const descriptor=one.record.has(message.key)?Object.getOwnPropertyDescriptor(one.value,message.key):undefined;
        return descriptor?{list:[Boolean(descriptor.enumerable),'value' in descriptor]}:null;
      }
      return (Array.isArray(one.value)?Object.hasOwn(one.value,message.key):one.get.has(message.key))?{list:[true,true]}:null;
    }
    if(message.op==='get') {
      if(typeof message.key!=='string'||(!one.get.has(message.key)&&!(Array.isArray(one.value)&&/^(?:0|[1-9][0-9]*|length)$/.test(message.key)))) return {u:1};
      if(one.value===input.page.window&&message.key==='console') return encode({log(){},warn(){},error(){},info(){},debug(){}});
      const property=one.record?recordProperty(one.value,message.key):undefined;
      const result=one.record?(property&&'value' in property?property.value:undefined):one.value[message.key];
      if(one.record&&typeof result==='function'&&!Object.hasOwn(one.value,message.key)) return {u:1};
      if(typeof result==='function') {
        if(!one.bound) return encode(result);
        // Bound methods never hand out their receiver, prototype or symbols.
        let methods=boundMethods.get(one.value); if(!methods) {methods=new Map();boundMethods.set(one.value,methods);}
        const existing=methods.get(message.key); if(existing&&existing.raw===result) return existing.wire;
        const bound=(...args:any[])=>{
          if(message.key==='addEventListener') listeners.push({target:one.value,name:args[0],fn:args[1],options:typeof args[2]==='object'?Boolean(args[2]?.capture):Boolean(args[2])});
          return Reflect.apply(result,one.value,args);
        };
        const wire=capability(bound,[],[],bound); methods.set(message.key,{raw:result,wire}); return wire;
      }
      return encode(result);
    }
    if(message.op==='set') {
      if(typeof message.key!=='string'||(!one.set.has(message.key)&&!(Array.isArray(one.value)&&/^(?:0|[1-9][0-9]*|length)$/.test(message.key)))) throw new TypeError('Capability property is read only');
      if(one.record){const descriptor=Object.getOwnPropertyDescriptor(one.value,message.key);if(!descriptor||!('value'in descriptor)||!descriptor.writable)throw new TypeError('Capability property is read only');}
      one.value[message.key]=decode(message.value); return {u:1};
    }
    if(message.op==='call') {
      if(!one.invoke||!Array.isArray(message.args)||message.args.length>1000) throw new TypeError('Capability is not callable');
      return encode(one.invoke(...message.args.map(decode)));
    }
    if(message.op==='subscribe') {
      if(!types.isPromise(one.value)) throw new TypeError('Capability is not a promise');
      const yes=decode(message.yes),no=decode(message.no);
      Promise.prototype.then.call(one.value,(result:any)=>{if(!disposed) yes(result);},(error:any)=>{if(!disposed) no(error);});
      return {u:1};
    }
    throw new Error('Invalid capability operation');
  };
  const request=vm.newFunction('capability',data=>{
    let result;
    try { const text=vm.getString(data); if(text.length>1_000_000) throw new Error('Capability request is too large'); const message=JSON.parse(text); result={value:callHost(message)}; }
    catch(error) { result={error:{name:(error as Error).name||'Error',message:String((error as Error).message||'Capability failed').slice(0,2000)}}; }
    return vm.newString(JSON.stringify(result));
  });
  const schedule=vm.newFunction('schedule',()=>{
    if(!flushQueued) { flushQueued=true; queueMicrotask(()=>{flushQueued=false; if(!disposed) {try{invoke({op:'flush'});}catch(error){input.report('callback-error',error);}}}); }
    return vm.undefined;
  });
  const report=vm.newFunction('report',(type,reason)=>{input.report(vm.getString(type),decode(vm.dump(reason))); return vm.undefined;});
  const react=input.modules.react as any;
  const reactFacade=Object.fromEntries(REACT_EXPORTS.filter(name=>name in react).map(name=>[name,react[name]]));
  const jsx=input.modules['react/jsx-runtime'] as any;
  const materialize=(value:any,depth=0):any=>{
    if(depth>50) throw new Error('React props are too deep');
    if(!value||typeof value!=='object'||!guestIds.has(value)||types.isPromise(value)||value instanceof Map||value instanceof Set) return value;
    if(Array.isArray(value)) return Array.from(value,item=>materialize(item,depth+1));
    return Object.fromEntries(Object.keys(value).map(key=>[key,materialize(value[key],depth+1)]));
  };
  reactFacade.createElement=(type:any,props:any,...children:any[])=>react.createElement(type,materialize(props),...children.map(child=>materialize(child)));
  reactFacade.cloneElement=(element:any,props:any,...children:any[])=>react.cloneElement(element,materialize(props),...children.map(child=>materialize(child)));
  const globals:Record<string,Wire>={};
  for(const name of ['window','document','localStorage','sessionStorage']) if(input.page[name]) globals[name]=encode(input.page[name]);
  for(const name of ['setTimeout','setInterval','requestAnimationFrame']) {
    const clearName=name==='setTimeout'?'clearTimeout':name==='setInterval'?'clearInterval':'cancelAnimationFrame';
    const method=(callback:any,delay?:number,...args:any[])=>{
      const timer=input.page[name]((...callArgs:any[])=>{if(!disposed) callback(...callArgs);},delay,...args);
      timers.set(timer,{clear:input.page[clearName]}); return timer;
    };
    globals[name]=encode(method); globals[clearName]=encode((timer:any)=>{const entry=timers.get(timer); entry?.clear(timer); timers.delete(timer);});
  }
  const networkFetch=globalThis.fetch;
  globals.fetch=encode((...args:any[])=>{
    if(typeof input.page.fetch!=='function'||input.page.fetch===networkFetch) return Promise.reject(new Error('No training fetch fixture is installed'));
    return input.page.fetch(...args);
  });
  globals.crypto=encode({randomUUID:()=>input.page.crypto.randomUUID()});
  globals.performance=encode({now:()=>input.page.performance.now()});
  globals.Intl=encode(Object.fromEntries(['DateTimeFormat','NumberFormat','Collator','PluralRules','RelativeTimeFormat','ListFormat','DisplayNames'].filter(name=>typeof input.page.Intl?.[name]==='function').map(name=>[name,(...args:any[])=>Reflect.construct(input.page.Intl[name],args)])));
  for(const name of ['AbortController','DOMException','URL','URLSearchParams','Headers']) {
    const constructor=input.page[name]; if(typeof constructor==='function') globals[name]=capability(constructor,[],[],(...args)=>Reflect.construct(constructor,args));
  }
  const nodeTypes=Object.fromEntries(['Element','HTMLElement','HTMLInputElement','Node'].map(name=>[name,encode((value:any)=>value instanceof input.page[name])]));
  const locale=(type:string,time:number,locales:any,options:any)=>{
    const date=new Date(time), opts={timeZone:'UTC',...(options?materialize(options):{})};
    return type==='date'?date.toLocaleDateString(locales,opts):type==='time'?date.toLocaleTimeString(locales,opts):date.toLocaleString(locales,opts);
  };
  const roots=vm.newString(JSON.stringify({modules:{react:encode(reactFacade),'react/jsx-runtime':encode({jsx:(type:any,props:any,key:any)=>jsx.jsx(type,materialize(props),key),jsxs:(type:any,props:any,key:any)=>jsx.jsxs(type,materialize(props),key),Fragment:jsx.Fragment})},globals,now:encode(()=>input.page.Date.now()),locale:encode(locale),nodeTypes}));
  const factory=evaluate(`(${BOOTSTRAP})`);
  const rootsParse=evaluate('(text)=>JSON.parse(text)');
  const parsed=vm.callFunction(rootsParse,vm.undefined,roots); roots.dispose(); rootsParse.dispose();
  if(parsed.error) throw new Error('Invalid learner roots');
  const initialized=vm.callFunction(factory,vm.undefined,request,schedule,report,parsed.value);
  factory.dispose();request.dispose();schedule.dispose();report.dispose();parsed.value.dispose();
  if(initialized.error) {const message=thrownText(dumpThrown(vm,initialized.error),'Learner engine failed'); disposeQuietly(); throw new Error(message);}
  command=initialized.value;
  const load=(name:string,source:string): any => enter(()=>{
    const loader=evaluate(`(require,module,exports)=>{${source}\n}`);
    // Only the host can pass this loader to the private command. Neither
    // loader, command nor eval/Function is exposed to the learner module.
    const data=vm.newString(JSON.stringify({op:'module',name}));
    const loaded=vm.callFunction(command,vm.undefined,data,loader); data.dispose();loader.dispose();
    if(loaded.error) throw new Error(thrownText(dumpThrown(vm,loaded.error),'threw a value with no message'));
    const wire=JSON.parse(vm.getString(loaded.value)); loaded.value.dispose();return decode(wire);
  });
  try {
    // Suites install their own fixture on the trusted page. Learner modules
    // may import the same deterministic helpers; their global fetch continues
    // to delegate to that page's current fixture, including suite overrides.
    const fetchBefore=vm.getProp(vm.global,'fetch');
    for(const [name,source] of Object.entries(input.fixtures)) load(name,source);
    vm.setProp(vm.global,'fetch',fetchBefore); fetchBefore.dispose();
    const exports=load('./App',input.source) as Record<string,unknown>;
    return {exports,dispose:disposeQuietly};
  } catch(error) {disposeQuietly();throw error;}
}
