/**
 * Open VeloCore (`open-velo-core`) — Self-Contained Browser & Node SDK
 *
 * Provides a headless, framework-agnostic cycling telemetry, smart trainer control,
 * physiological modeling, and workout target compliance engine powered by Rust + WebAssembly.
 */

export { VeloCoreEngine, veloCoreEngine } from './VeloCoreEngine';
export {
  VeloCoreWasmRuntime,
  WASM_MASK_BALANCE,
  WASM_MASK_CADENCE,
  WASM_MASK_HR,
  WASM_MASK_POWER,
  WASM_MASK_SPEED,
} from './wasm/wasmBinary';
export type { DecodedFrameResult, VeloCoreWasmExports } from './wasm/wasmBinary';

export * from './types';
export * from './workouts';
