/**
 * Stage.tsx
 *
 * 3D シーンのルートコンテナ。
 * @react-three/fiber の Canvas + 環境設定をラップする。
 *
 * 使い方:
 *   <Stage environment="warehouse" ambientIntensity={0.5}>
 *     ...
 *   </Stage>
 *
 * ## ESM / peer dep 対応について
 *
 * @react-three/fiber と @react-three/drei は optional peer dep。
 * ESM 環境では require() は動作しないため、動的 import() を使い
 * useEffect でモジュールをロードする。
 *
 * - R3F が利用可能 → Canvas + ambientLight + Environment でレンダリング
 * - R3F が利用不可 → <div> フォールバック（ローダーのみ使う場合）
 */
import React, { Suspense, useState, useEffect } from 'react';
import type { StageProps } from '@static3d/types';
import type { CanvasProps } from '@react-three/fiber';

// ────────────────────────────────────────────────────────────────────────────
// 動的 import で取得する peer dep の型
// ────────────────────────────────────────────────────────────────────────────

type R3FCanvas = React.ComponentType<CanvasProps>;
type DreiEnvironment = React.ComponentType<{
  preset?: string;
  background?: boolean;
}>;

interface PeerModules {
  Canvas: R3FCanvas;
  Environment: DreiEnvironment | null;
}

// ────────────────────────────────────────────────────────────────────────────
// モジュールキャッシュ（コンポーネントの再マウントで再 import しない）
// ────────────────────────────────────────────────────────────────────────────

let cachedModules: PeerModules | null = null;
let loadPromise: Promise<PeerModules | null> | null = null;

async function loadPeerModules(): Promise<PeerModules | null> {
  if (cachedModules) return cachedModules;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const [r3f, drei] = await Promise.allSettled([
        import('@react-three/fiber'),
        import('@react-three/drei'),
      ]);

      if (r3f.status === 'rejected') {
        // R3F がなければ Canvas を提供できない → null
        loadPromise = null;
        return null;
      }

      const Canvas = (r3f.value as typeof import('@react-three/fiber'))
        .Canvas as unknown as R3FCanvas;

      const Environment =
        drei.status === 'fulfilled'
          ? ((drei.value as typeof import('@react-three/drei'))
              .Environment as unknown as DreiEnvironment)
          : null;

      cachedModules = { Canvas, Environment };
      return cachedModules;
    } catch {
      loadPromise = null;
      return null;
    }
  })();

  return loadPromise;
}

// ────────────────────────────────────────────────────────────────────────────
// Stage
// ────────────────────────────────────────────────────────────────────────────

type StageImplProps = StageProps & { canvasProps?: Omit<CanvasProps, 'children'> };

export function Stage({
  environment = 'warehouse',
  ambientIntensity = 0.5,
  background = '#000000',
  shadows = true,
  className,
  style,
  children,
}: StageImplProps): React.JSX.Element {
  // null = loading, false = unavailable, PeerModules = ready
  const [mods, setMods] = useState<PeerModules | null | false>(
    cachedModules ?? null
  );

  useEffect(() => {
    if (cachedModules) {
      setMods(cachedModules);
      return;
    }
    loadPeerModules().then((m) => setMods(m ?? false));
  }, []);

  // peer dep ロード中または利用不可 → フォールバック
  if (!mods) {
    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          background,
          ...(style as React.CSSProperties),
        }}
      >
        {/* mods===null はローディング中, false は peer dep 未インストール */}
        {children as React.ReactNode}
      </div>
    );
  }

  const { Canvas, Environment } = mods;

  return (
    <Canvas
      shadows={shadows}
      className={className}
      style={{ background, ...(style as React.CSSProperties) }}
    >
      <ambientLight intensity={ambientIntensity} />
      <Suspense fallback={null}>
        {Environment && (
          <Environment preset={environment} background={false} />
        )}
        {children as React.ReactNode}
      </Suspense>
    </Canvas>
  );
}
