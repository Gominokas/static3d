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

  const transitionTo = (target: CameraState, config?: TransitionConfig): void => {
    engineRef.current!.transitionTo(target, config);
    setCurrentCamera(target);
  };

  // camera props が変わったら遷移を開始
  useEffect(() => {
    engineRef.current!.transitionTo(camera, transition);
    setCurrentCamera(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    camera.position.join(','),
    camera.target.join(','),
    camera.fov,
  ]);

  // R3F useFrame からエンジンを動かす（r3f が利用可能な場合のみ）
  useEffect(() => {
    let animFrameId: number;
    let lastTime = performance.now();

    const tick = (now: number): void => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      engineRef.current!.tick(delta);
      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, []);

  const value: RoomContextValue = {
    engine: engineRef.current,
    currentCamera,
    transitionTo,
  };

  return (
    <RoomContext.Provider value={value}>
      {children as React.ReactNode}
    </RoomContext.Provider>
  );
}
