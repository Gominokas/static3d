/**
 * Overlay.tsx
 *
 * 3D 空間上の指定座標に HTML コンテンツをオーバーレイするコンポーネント。
 * @react-three/drei の Html コンポーネントをラップする。
 *
 * 使い方:
 *   <Overlay position={[0, 2, 0]} anchor="bottom-center">
 *     <h1>ケーキ屋へようこそ</h1>
 *   </Overlay>
 *
 * ## ESM / peer dep 対応について
 *
 * @react-three/drei は optional peer dep。
 * ESM 環境では require() は動作しないため、動的 import() で
 * drei.Html をロードする。
 *
 * - drei が利用可能 → drei Html コンポーネントで 3D 空間内にレンダリング
 * - drei が利用不可 → absolute 配置の div にフォールバック
 *
 * NOTE: drei.Html は R3F Canvas の内側で使う必要がある。
 *       Canvas 外で Overlay を使う場合は常に div フォールバックになる。
 */
import React, { useState, useEffect } from 'react';
import type { OverlayProps, OverlayAnchor, Vec3 } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// アンカー → CSS transform 変換
// ────────────────────────────────────────────────────────────────────────────

function anchorToTransform(anchor: OverlayAnchor): string {
  switch (anchor) {
    case 'top-left':
      return 'translate(0%, 0%)';
    case 'top-center':
      return 'translate(-50%, 0%)';
    case 'top-right':
      return 'translate(-100%, 0%)';
    case 'bottom-left':
      return 'translate(0%, -100%)';
    case 'bottom-center':
      return 'translate(-50%, -100%)';
    case 'bottom-right':
      return 'translate(-100%, -100%)';
    case 'center':
    default:
      return 'translate(-50%, -50%)';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// drei.Html の型（peer dep の型を直接 import せず自前で定義）
// ────────────────────────────────────────────────────────────────────────────

type DreiHtmlProps = {
  position?: Vec3;
  occlude?: boolean;
  distanceFactor?: number;
  /** 3D transform モード（position/rotation/scale が 3D 変換に対応） */
  transform?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

type DreiHtmlComponent = React.ComponentType<DreiHtmlProps>;

// ────────────────────────────────────────────────────────────────────────────
// モジュールキャッシュ
// ────────────────────────────────────────────────────────────────────────────

let cachedHtml: DreiHtmlComponent | false | null = null; // null=未ロード, false=利用不可

async function loadHtml(): Promise<DreiHtmlComponent | false> {
  if (cachedHtml !== null) return cachedHtml;

  try {
    const drei = await import('@react-three/drei');
    cachedHtml = drei.Html as unknown as DreiHtmlComponent;
    return cachedHtml;
  } catch {
    cachedHtml = false;
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Overlay
// ────────────────────────────────────────────────────────────────────────────

export function Overlay({
  position,
  anchor = 'bottom-center',
  occlude = false,
  distanceFactor,
  children,
}: OverlayProps): React.JSX.Element {
  // null = ロード中, false = 利用不可, DreiHtmlComponent = ready
  const [Html, setHtml] = useState<DreiHtmlComponent | false | null>(
    cachedHtml // すでにキャッシュがあれば初期値として使う
  );

  useEffect(() => {
    if (cachedHtml !== null) {
      setHtml(cachedHtml);
      return;
    }
    loadHtml().then(setHtml);
  }, []);

  const cssTransform = anchorToTransform(anchor);

  // drei.Html が利用可能かつロード済み
  if (Html) {
    return (
      <Html
        position={position}
        occlude={occlude}
        distanceFactor={distanceFactor}
        transform
        style={{ transform: cssTransform, pointerEvents: 'auto' }}
      >
        {children as React.ReactNode}
      </Html>
    );
  }

  // Fallback: absolute 配置の div
  // (ロード中 Html===null の間も同じフォールバックを表示)
  return (
    <div
      data-overlay-position={position.join(',')}
      data-overlay-anchor={anchor}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) ${cssTransform}`,
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    >
      {children as React.ReactNode}
    </div>
  );
}
