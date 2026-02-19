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

// ── Product overlay ───────────────────────────────────────────────────────
export { ProductCard } from './scene/ProductCard.js';
export type { ProductCardProps } from './scene/ProductCard.js';
export { ProductOverlay, initialFadeState, fadeStyle, FADE_DURATION_MS } from './scene/ProductOverlay.js';
export type { ProductOverlayProps, FadeState } from './scene/ProductOverlay.js';
export type { ProductData } from './scene/products.js';
export { PRODUCTS, DEFAULT_PRODUCT } from './scene/products.js';

// ── Camera engine ────────────────────────────────────────────────────────
export { CameraEngine } from './scene/engine/CameraEngine.js';
export type { CameraEngineState } from './scene/engine/CameraEngine.js';

export { useCameraTransition } from './scene/engine/useCameraTransition.js';
export type {
  OrbitControlsHandle,
  CameraTransitionResult,
} from './scene/engine/useCameraTransition.js';

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
