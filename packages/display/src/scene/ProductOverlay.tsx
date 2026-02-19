/**
 * ProductOverlay.tsx
 *
 * 3D ショーケース上に商品カードを表示する Overlay コンポーネント。
 *
 * ## 動作
 *
 * - `visible=true`:
 *   カメラがショーケースにズームした後に呼び出す。
 *   商品カードが CSS フェードイン（opacity 0→1, translateY -8px→0）で現れる。
 *
 * - `visible=false`:
 *   カメラをリセットした時に呼び出す。
 *   フェードアウト後に DOM からアンマウントする（`display:none` ではなく完全除去）。
 *
 * ## 使い方
 *
 *   const [showCard, setShowCard] = useState(false);
 *
 *   // ショーケースクリック
 *   <Spot onClick={() => { animateTo(SHOWCASE_CAM); setShowCard(true); }}>
 *     <mesh>...</mesh>
 *   </Spot>
 *
 *   // Overlay（Canvas 内）
 *   <ProductOverlay
 *     position={[0, 1.8, 0]}
 *     anchor="top-center"
 *     product={PRODUCTS['strawberry-shortcake']}
 *     visible={showCard}
 *     onClose={() => setShowCard(false)}
 *   />
 *
 * ## 制約
 *
 * - R3F / drei は optional peer dep。drei がない場合は div フォールバックになる
 *   （Overlay コンポーネントの仕様に準拠）。
 * - types パッケージは変更しない。
 */

import React, { useState, useEffect, useRef } from 'react';
import { Overlay } from './Overlay.js';
import { ProductCard } from './ProductCard.js';
import type { ProductData } from './products.js';
import type { Vec3, OverlayAnchor } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// アニメーション定数
// ────────────────────────────────────────────────────────────────────────────

/** フェードイン / アウトのトランジション時間（ms） */
export const FADE_DURATION_MS = 300;

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

export interface ProductOverlayProps {
  /** 3D 空間上のアンカー座標（ショーケース上部など） */
  position: Vec3;
  /** HTML アンカー基準（デフォルト: 'top-center'） */
  anchor?: OverlayAnchor;
  /** 表示する商品データ */
  product: ProductData;
  /** true: フェードイン表示 / false: フェードアウト後アンマウント */
  visible: boolean;
  /** 「詳しく見る」クリックハンドラ（省略時は product.detailUrl へ遷移） */
  onDetailClick?: (product: ProductData) => void;
  /** ✕ ボタンクリックハンドラ（visible を false にするコールバック） */
  onClose?: () => void;
  /** drei の occlude 設定（デフォルト: false） */
  occlude?: boolean;
  /** drei の distanceFactor 設定 */
  distanceFactor?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit testing)
// ────────────────────────────────────────────────────────────────────────────

/** フェードステート */
export type FadeState = 'hidden' | 'entering' | 'visible' | 'leaving';

/**
 * visible prop からの初期フェードステートを返す純粋関数。
 * - visible=true  → 'visible'（マウント直後から表示）
 * - visible=false → 'hidden'（非表示）
 */
export function initialFadeState(visible: boolean): FadeState {
  return visible ? 'visible' : 'hidden';
}

/**
 * フェードステートに応じた CSS スタイルを返す純粋関数。
 */
export function fadeStyle(state: FadeState, durationMs: number): React.CSSProperties {
  const opacity = state === 'visible' ? 1 : 0;
  const translateY = state === 'visible' ? '0px' : '-8px';
  return {
    opacity,
    transform: `translateY(${translateY})`,
    transition: `opacity ${durationMs}ms ease, transform ${durationMs}ms ease`,
    position: 'relative',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ProductOverlay
// ────────────────────────────────────────────────────────────────────────────

/**
 * ショーケース上に商品カードをオーバーレイ表示するコンポーネント。
 * visible prop の変化でフェードイン / フェードアウトする。
 */
export function ProductOverlay({
  position,
  anchor = 'top-center',
  product,
  visible,
  onDetailClick,
  onClose,
  occlude = false,
  distanceFactor,
}: ProductOverlayProps): React.JSX.Element | null {
  /**
   * フェードステート:
   *   'hidden'   — 完全に非表示（DOM からアンマウント）
   *   'entering' — フェードイン中
   *   'visible'  — 完全表示
   *   'leaving'  — フェードアウト中
   */
  const [fadeState, setFadeState] = useState<FadeState>(initialFadeState(visible));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (visible) {
      // まずマウントして 'entering' 状態に（次フレームで opacity を 1 にする）
      setFadeState('entering');
      // rAF で 1 フレーム待ってから 'visible' にする（CSS transition 発火のため）
      const raf = requestAnimationFrame(() => {
        setFadeState('visible');
      });
      return () => cancelAnimationFrame(raf);
    } else {
      // フェードアウト開始
      setFadeState((prev) => {
        if (prev === 'hidden') return 'hidden'; // すでに非表示
        return 'leaving';
      });
      // トランジション完了後にアンマウント
      timerRef.current = setTimeout(() => {
        setFadeState('hidden');
        timerRef.current = null;
      }, FADE_DURATION_MS);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible]);

  // 完全に非表示のときは DOM から除去
  if (fadeState === 'hidden') {
    return null;
  }

  // opacity / transform はフェードステートに応じて変化
  const wrapperStyle: React.CSSProperties = fadeStyle(fadeState, FADE_DURATION_MS);

  // ✕ ボタンスタイル
  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    border: 'none',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.15)',
    color: '#444',
    fontSize: 14,
    lineHeight: '24px',
    textAlign: 'center',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  };

  return (
    <Overlay
      position={position}
      anchor={anchor}
      occlude={occlude}
      distanceFactor={distanceFactor}
    >
      <div
        style={wrapperStyle}
        data-product-overlay
        data-fade-state={fadeState}
        data-product-id={product.id}
      >
        {/* ✕ 閉じるボタン */}
        {onClose && (
          <button
            style={closeButtonStyle}
            aria-label="商品カードを閉じる"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            ✕
          </button>
        )}

        <ProductCard
          product={product}
          onDetailClick={onDetailClick}
          style={onClose ? { paddingTop: 28 } : undefined}
        />
      </div>
    </Overlay>
  );
}
