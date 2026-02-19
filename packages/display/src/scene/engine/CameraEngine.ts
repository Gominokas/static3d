/**
 * CameraEngine.ts
 *
 * カメラ遷移アニメーションエンジン。
 * @react-three/fiber の useFrame を使い、CameraState 間を
 * イージング関数でスムーズに補間する。
 *
 * ブラウザ専用。Node.js モジュールは使わない。
 */
import type { CameraState, TransitionConfig, Vec3 } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// イージング関数
// ────────────────────────────────────────────────────────────────────────────

type EasingFn = (t: number) => number;

const easings: Record<NonNullable<TransitionConfig['easing']>, EasingFn> = {
  linear: (t) => t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
};

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ────────────────────────────────────────────────────────────────────────────
// CameraEngine
// ────────────────────────────────────────────────────────────────────────────

export interface CameraEngineState {
  /** 現在のカメラ位置 */
  position: Vec3;
  /** 現在の注視点 */
  target: Vec3;
  /** 現在の FOV */
  fov: number;
  /** 遷移中か否か */
  isTransitioning: boolean;
}

export class CameraEngine {
  private current: CameraEngineState;
  private from: CameraState | null = null;
  private to: CameraState | null = null;
  private progress = 0; // 0–1
  private duration = 1.0; // 秒
  private easingFn: EasingFn = easings.easeInOutCubic;

  constructor(initial: CameraState) {
    this.current = {
      position: initial.position,
      target: initial.target,
      fov: initial.fov ?? 60,
      isTransitioning: false,
    };
  }

  /**
   * 指定した CameraState へ遷移を開始する。
   * すでに遷移中の場合は現在の補間状態から続けて遷移する。
   */
  transitionTo(target: CameraState, config?: TransitionConfig): void {
    this.from = {
      position: [...this.current.position] as Vec3,
      target: [...this.current.target] as Vec3,
      fov: this.current.fov,
    };
    this.to = target;
    this.progress = 0;
    this.duration = config?.duration ?? 1.0;
    this.easingFn = easings[config?.easing ?? 'easeInOutCubic'];
    this.current.isTransitioning = true;
  }

  /**
   * useFrame のコールバックから毎フレーム呼ぶ。
   * @param delta 前フレームからの経過秒数
   * @returns 現在のカメラ状態
   */
  tick(delta: number): CameraEngineState {
    if (!this.current.isTransitioning || !this.from || !this.to) {
      return this.current;
    }

    this.progress = Math.min(1, this.progress + delta / this.duration);
    const t = this.easingFn(this.progress);

    this.current.position = lerpVec3(this.from.position, this.to.position, t);
    this.current.target = lerpVec3(
      this.from.target,
      this.to.target,
      t
    );
    this.current.fov = lerp(
      this.from.fov ?? 60,
      this.to.fov ?? 60,
      t
    );

    if (this.progress >= 1) {
      this.current.isTransitioning = false;
      this.from = null;
    }

    return { ...this.current };
  }

  /** 現在の状態を即座に設定（アニメーションなし） */
  set(state: CameraState): void {
    this.current = {
      position: state.position,
      target: state.target,
      fov: state.fov ?? 60,
      isTransitioning: false,
    };
    this.from = null;
    this.to = null;
    this.progress = 0;
  }

  /** 現在のカメラ状態を返す */
  getState(): CameraEngineState {
    return { ...this.current };
  }
}
