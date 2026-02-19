/**
 * Room.tsx
 *
 * URL ルートとカメラ位置を紐付けるコンポーネント。
 * マウント時または camera props の変更時にカメラ遷移を開始する。
 *
 * 使い方:
 *   <Room camera={{ position: [0,5,10], target: [0,0,0], fov: 60 }}
 *         transition={{ duration: 1.5, easing: 'easeInOutCubic' }}>
 *     ...
 *   </Room>
 *
 * ## OrbitControls との共存
 *
 * Room は遷移中かどうかを context 経由で公開する。
 * OrbitControls は遷移中に自動無効化されるよう、
 * useCameraTransition フックが enabled prop を管理する。
 *
 *   const { animateTo, isAnimating } = useCameraTransition(controlsRef);
 *   <OrbitControls ref={controlsRef} enabled={!isAnimating} />
 *
 * Room 自身は requestAnimationFrame ループを持たない。
 * カメラの実際の更新は useCameraTransition の useFrame が担う。
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CameraEngine } from './engine/CameraEngine.js';
import type { RoomProps, CameraState, TransitionConfig } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────────────────────

export interface RoomContextValue {
  engine: CameraEngine;
  currentCamera: CameraState;
  isTransitioning: boolean;
  transitionTo: (target: CameraState, config?: TransitionConfig) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) {
    throw new Error('[static3d] useRoom must be used inside <Room>');
  }
  return ctx;
}

// ────────────────────────────────────────────────────────────────────────────
// Room
// ────────────────────────────────────────────────────────────────────────────

export function Room({
  camera,
  transition,
  children,
}: RoomProps): React.JSX.Element {
  const engineRef = useRef<CameraEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new CameraEngine(camera);
  }

  const [currentCamera, setCurrentCamera] = useState<CameraState>(camera);
  const [isTransitioning, setIsTransitioning] = useState(false);

  /**
   * 遷移を開始する。
   * 実際のカメラ更新は useCameraTransition の useFrame が担う。
   * Room はエンジンに遷移先を伝えるだけ。
   */
  const transitionTo = (target: CameraState, config?: TransitionConfig): void => {
    engineRef.current!.transitionTo(target, config);
    setCurrentCamera(target);
    setIsTransitioning(true);
  };

  // camera props が変わったら遷移を開始
  useEffect(() => {
    transitionTo(camera, transition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    camera.position.join(','),
    camera.target.join(','),
    camera.fov,
  ]);

  /**
   * エンジンの isTransitioning を React state に同期するポーリング。
   * useCameraTransition が tick() を呼ぶたびに isTransitioning が変化するため、
   * 遷移完了を検知して state を更新する（tick 完了通知のためのシンプルな実装）。
   *
   * NOTE: useCameraTransition が Room 内で使われる場合、
   *       tick() の戻り値をチェックして isTransitioning state を更新できるが、
   *       Room はフレームループを持たないため、エンジン状態を useEffect で監視する。
   *       実際の同期は useCameraTransition の onComplete コールバックで行う。
   */
  const syncTransitionState = (): void => {
    const engineState = engineRef.current?.getState();
    if (engineState && !engineState.isTransitioning && isTransitioning) {
      setIsTransitioning(false);
    }
  };

  const value: RoomContextValue = {
    engine: engineRef.current,
    currentCamera,
    isTransitioning,
    transitionTo,
  };

  // エンジン状態を context に反映するため、syncTransitionState を value に注入
  // (useCameraTransition がこれを呼ぶ)
  (value as RoomContextValue & { _sync: () => void })._sync = syncTransitionState;

  return (
    <RoomContext.Provider value={value}>
      {children as React.ReactNode}
    </RoomContext.Provider>
  );
}
