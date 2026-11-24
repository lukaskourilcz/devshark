/** Pinned Node24-compatible QuickJS module, shared by both learner VMs.
 * SDK0.32's supported wasmModule hook keeps its existing loader and FFI ABI.
 * Module bytes are embedded for the self-contained worker/React guest bundle.
 */
import { Buffer } from 'node:buffer';
import { newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten';
import importedVariant from '@jitl/quickjs-singlefile-cjs-release-sync';
import wasmBase64 from './vendor/quickjs-node24.cjs';

// Node ESM wraps the CommonJS default; the bundled worker resolves it directly.
const base = (importedVariant as typeof importedVariant & { default?: typeof importedVariant }).default ?? importedVariant;
let binary: ArrayBuffer | undefined;
const loadBinary = () => binary ??= Uint8Array.from(Buffer.from(wasmBase64, 'base64')).buffer;

const pinnedWasm = {
  wasmModule: () => WebAssembly.compile(loadBinary()),
  wasmBinary: async () => loadBinary(),
};

export default newVariant(base, pinnedWasm);

/** Emscripten waits for the success callback and discards instantiateWasm's
 * returned promise. In the public health function a rejected compilation or
 * instantiation must reject the check without terminating the HTTP process. */
export function healthVariant(): QuickJSSyncVariant {
  const guarded: QuickJSSyncVariant = {
    ...base,
    async importModuleLoader() {
      const imported = await base.importModuleLoader();
      const first = typeof imported === 'function' ? imported : imported.default;
      const load = typeof first === 'function' ? first : first.default;
      return (options) => new Promise((resolve, reject) => {
        const instantiate = options?.instantiateWasm;
        if (options && instantiate) {
          options.instantiateWasm = (...args) => {
            const result = instantiate(...args);
            void Promise.resolve(result).catch(reject);
            return result;
          };
        }
        load(options).then(resolve, reject);
      });
    },
  };
  return newVariant(guarded, pinnedWasm);
}
