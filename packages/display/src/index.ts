/**
 * @static3d/display — public API
 *
 * ブラウザ専用パッケージ。
 * manifest.json を読んで CDN からアセットを fetch するローダーと、
 * React/R3F ベースの 3D 空間コンポーネントを提供する。
 *
 * Node.js モジュール（fs, path 等）は一切使わない。
 */

// ── Loader ───────────────────────────────────────────────────────────────
export { AssetLoader } from './loader/AssetLoader.js';
export type { AssetMap } from './loader/types.js';

// ── React hooks & Provider ───────────────────────────────────────────────
export {
  AssetProvider,
  useAssetContext,
} from './react/AssetProvider.js';
export type {
  AssetProviderProps,
  AssetContextValue,
} from './react/AssetProvider.js';

export { useAsset, clearAssetCache } from './react/useAsset.js';

export { useAssetProgress } from './react/useAssetProgress.js';
export type { ProgressState } from './react/useAssetProgress.js';

// ── Scene components ─────────────────────────────────────────────────────
export { Stage } from './scene/Stage.js';
export { Room, useRoom } from './scene/Room.js';
export type { RoomContextValue } from './scene/Room.js';
export { Spot } from './scene/Spot.js';
export { Overlay } from './scene/Overlay.js';

// ── Camera engine ────────────────────────────────────────────────────────
export { CameraEngine } from './scene/engine/CameraEngine.js';
export type { CameraEngineState } from './scene/engine/CameraEngine.js';

// ── Types (re-export from @static3d/types) ───────────────────────────────
export type {
  LoaderOptions,
  LoadOptions,
  LoadAllOptions,
  ProgressEvent,
  LoadError,
  AssetResult,
  Vec3,
  CameraState,
  TransitionConfig,
  StageProps,
  RoomProps,
  SpotProps,
  SpotHighlight,
  OverlayProps,
  OverlayAnchor,
} from '@static3d/types';
