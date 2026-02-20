/**
 * @static3d/loader — public API
 *
 * Framework-agnostic asset loader.
 * Works in React, Vue, Vanilla JS, or any browser-based runtime.
 * No React/R3F dependencies.
 */

export { AssetLoader } from './AssetLoader.js';
export type { AssetMap } from './types.js';
export type {
  LoaderOptions,
  LoadOptions,
  LoadAllOptions,
  ProgressEvent,
  LoadError,
  AssetResult,
} from './types.js';
