/**
 * @static3d/types — scene types
 *
 * React/R3F ベースのシーンコンポーネント (@static3d/display) で使う型定義。
 * Node.js 依存なし。React・Three.js の型は optional peer dep のため
 * ここでは直接 import せず、プリミティブ型でモデリングする。
 */

/** 3D 座標 [x, y, z] */
export type Vec3 = [number, number, number];

/** カメラ状態 */
export interface CameraState {
  /** カメラ位置 */
  position: Vec3;
  /** 注視点 */
  target: Vec3;
  /** 視野角（度） */
  fov?: number;
}

/** カメラ遷移設定 */
export interface TransitionConfig {
  /** 遷移時間（秒、デフォルト: 1.0） */
  duration?: number;
  /** イージング関数名（デフォルト: 'easeInOutCubic'） */
  easing?:
    | 'linear'
    | 'easeInCubic'
    | 'easeOutCubic'
    | 'easeInOutCubic'
    | 'easeInQuart'
    | 'easeOutQuart'
    | 'easeInOutQuart';
}

/** Stage コンポーネントの Props */
export interface StageProps {
  /**
   * @react-three/drei の Environment の preset
   * (例: 'warehouse', 'city', 'sunset', 'night', ...)
   */
  environment?: string;
  /** アンビエントライトの強度（デフォルト: 0.5） */
  ambientIntensity?: number;
  /** Canvas の背景色（CSS 色文字列、デフォルト: '#000000'） */
  background?: string;
  /** shadows を有効化（デフォルト: true） */
  shadows?: boolean;
  /** Canvas の className */
  className?: string;
  /** canvas style */
  style?: Record<string, string | number>;
  children?: unknown;
}

/** Room コンポーネントの Props */
export interface RoomProps {
  /** カメラ位置・注視点・FOV */
  camera: CameraState;
  /** カメラ遷移設定 */
  transition?: TransitionConfig;
  children?: unknown;
}

/** Spot のハイライト表現 */
export type SpotHighlight = 'outline' | 'glow' | 'scale' | 'color' | 'none';

/** Spot コンポーネントの Props */
export interface SpotProps {
  /** クリック時の遷移先パス（react-router の to と同じ形式） */
  to?: string;
  /** ホバー・フォーカス時のハイライト（デフォルト: 'outline'） */
  highlight?: SpotHighlight;
  /** ツールチップテキスト */
  tooltip?: string;
  /** クリックハンドラ */
  onClick?: () => void;
  /** ホバーハンドラ */
  onHover?: (hovered: boolean) => void;
  /** 無効化 */
  disabled?: boolean;
  children?: unknown;
}

/** Overlay のアンカー位置 */
export type OverlayAnchor =
  | 'center'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Overlay コンポーネントの Props */
export interface OverlayProps {
  /** 3D 空間上の位置 */
  position: Vec3;
  /** HTML のアンカー基準（デフォルト: 'bottom-center'） */
  anchor?: OverlayAnchor;
  /** オクルージョンを有効化（デフォルト: false） */
  occlude?: boolean;
  /** 距離スケーリングを無効化（デフォルト: false） */
  distanceFactor?: number;
  children?: unknown;
}
