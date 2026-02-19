/**
 * useCameraTransition.ts
 *
 * CameraEngine を R3F / OrbitControls に統合するフック。
 *
 * 使い方:
 *
 *   const controlsRef = useRef<OrbitControlsImpl>(null);
 *   const { animateTo, isAnimating, cancel } = useCameraTransition(controlsRef);
 *
 *   // ショーケースクリック → 1.5秒かけてスムーズ移動
 *   const zoomToShowcase = () => {
 *     animateTo(
 *       { position: [3, 2, 5], target: [3, 1, 2], fov: 50 },
 *       { duration: 1.5, easing: 'easeInOutCubic' }
 *     );
 *   };
 *
 *   // R3F Canvas 内では:
 *   <OrbitControls ref={controlsRef} enabled={!isAnimating} />
 *
 * ## 動作
 *
 * - animateTo() 呼び出し → isAnimating=true、OrbitControls.enabled=false
 * - requestAnimationFrame で毎フレーム CameraEngine.tick(delta) を呼びカメラを更新
 * - 遷移完了 → isAnimating=false、OrbitControls.enabled=true
 * - cancel() → 遷移を即座に中断して現在位置で停止
 *
 * ## R3F useFrame との関係
 *
 * このフックは requestAnimationFrame を直接使う。
 * R3F Canvas 内で使う場合は useFrame の方が理想的だが、
 * フック自体に R3F 依存を持たせると Canvas 外（テスト・SSR）で壊れるため、
 * rAF を採用している。R3F Canvas 内で使っても問題なく動作する。
 */

import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { CameraEngine } from './CameraEngine.js';
import type { CameraState, TransitionConfig } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// OrbitControls の最小限インターフェース
// ────────────────────────────────────────────────────────────────────────────

/**
 * OrbitControls の操作に必要な最小限の型。
 * three-stdlib / @react-three/drei いずれの実装にも対応。
 * 完全な型依存を避けるため必要プロパティのみ定義する。
 */
export interface OrbitControlsHandle {
  /** コントロールを有効/無効にする */
  enabled: boolean;
  /** アタッチされた Three.js Camera */
  object?: {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    fov?: number;
    updateProjectionMatrix?: () => void;
  };
  /** 注視点ターゲット (THREE.Vector3 互換) */
  target?: {
    x: number; y: number; z: number;
    set: (x: number, y: number, z: number) => void;
  };
  /** コントロールの内部状態を更新する */
  update?: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// 戻り値の型
// ────────────────────────────────────────────────────────────────────────────

export interface CameraTransitionResult {
  /**
   * 指定した CameraState へアニメーション遷移を開始する。
   * 遷移中は isAnimating=true となり OrbitControls が自動無効化される。
   */
  animateTo: (target: CameraState, config?: TransitionConfig) => void;
  /** 遷移中のとき true */
  isAnimating: boolean;
  /** 遷移を即座に中断して現在位置で停止する */
  cancel: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// useCameraTransition
// ────────────────────────────────────────────────────────────────────────────

/**
 * CameraEngine を OrbitControls に統合し、スムーズなカメラ遷移を提供する。
 *
 * @param controlsRef OrbitControls の ref（null でも動作する）
 * @param initialState 初期カメラ状態（省略可）
 */
export function useCameraTransition(
  controlsRef: RefObject<OrbitControlsHandle | null>,
  initialState?: CameraState,
): CameraTransitionResult {
  const defaultInitial: CameraState = initialState ?? {
    position: [0, 5, 10],
    target: [0, 0, 0],
    fov: 60,
  };

  const engineRef = useRef<CameraEngine>(new CameraEngine(defaultInitial));
  const [isAnimating, setIsAnimating] = useState(false);

  // stale closure を避けるために ref でも管理
  const isAnimatingRef = useRef(false);
  const controlsRefSnapshot = useRef(controlsRef);
  controlsRefSnapshot.current = controlsRef;

  // ── rAF フレームループ ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isAnimating) return; // 遷移中のみ rAF を回す

    let rafId: number;
    let lastTime = performance.now();

    const tick = (now: number): void => {
      // 最大デルタを 100ms でクランプ（タブ非アクティブ時のスパイク対策）
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const state = engineRef.current.tick(delta);
      const controls = controlsRefSnapshot.current.current;

      // OrbitControls にカメラ位置を反映
      if (controls) {
        const cam = controls.object;
        if (cam) {
          cam.position.set(state.position[0], state.position[1], state.position[2]);
          if (cam.fov !== undefined && state.fov !== undefined) {
            cam.fov = state.fov;
            cam.updateProjectionMatrix?.();
          }
        }
        if (controls.target) {
          controls.target.set(state.target[0], state.target[1], state.target[2]);
        }
        controls.update?.();
      }

      // 遷移完了チェック
      if (!state.isTransitioning) {
        isAnimatingRef.current = false;
        setIsAnimating(false);
        if (controls) {
          controls.enabled = true;
        }
        return; // rAF を継続しない
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isAnimating]);

  // ── 公開 API ────────────────────────────────────────────────────────────

  const animateTo = useCallback(
    (target: CameraState, config?: TransitionConfig): void => {
      const controls = controlsRefSnapshot.current.current;

      // 現在の OrbitControls のカメラ位置をエンジンの開始点に反映
      if (controls?.object) {
        const { x, y, z } = controls.object.position;
        engineRef.current.set({
          position: [x, y, z],
          target: controls.target
            ? [controls.target.x, controls.target.y, controls.target.z]
            : engineRef.current.getState().target,
          fov: controls.object.fov ?? 60,
        });
      }

      engineRef.current.transitionTo(target, config);
      isAnimatingRef.current = true;
      setIsAnimating(true);

      // 遷移中は OrbitControls を無効化
      if (controls) {
        controls.enabled = false;
      }
    },
    [] // controlsRef は ref なので依存不要
  );

  const cancel = useCallback((): void => {
    const currentState = engineRef.current.getState();
    // 現在位置でエンジンを静止させる
    engineRef.current.set({
      position: currentState.position,
      target: currentState.target,
      fov: currentState.fov,
    });

    isAnimatingRef.current = false;
    setIsAnimating(false);

    const controls = controlsRefSnapshot.current.current;
    if (controls) {
      controls.enabled = true;
    }
  }, []);

  return { animateTo, isAnimating, cancel };
}
