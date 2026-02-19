/**
 * ProductCard.tsx
 *
 * ショーケース商品情報カードコンポーネント。
 * 純粋な HTML + インラインスタイルで構成され、R3F に依存しない。
 * Overlay の children として使う想定。
 *
 * 使い方:
 *   <ProductCard product={PRODUCTS['strawberry-shortcake']} />
 *
 * ## スタイル方針
 * - インラインスタイルのみ（CSS ファイル不要）
 * - モバイルでも読めるフォントサイズ（最小 14px）
 * - アクセシビリティ: role="article", aria-label
 * - ダークモードはスコープ外（背景を半透明白で対応）
 */

import React from 'react';
import type { ProductData } from './products.js';

// ────────────────────────────────────────────────────────────────────────────
// スタイル定数
// ────────────────────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
  padding: '20px 24px',
  minWidth: 220,
  maxWidth: 320,
  fontFamily: "'Noto Sans JP', 'Helvetica Neue', Arial, sans-serif",
  color: '#1a1a1a',
  pointerEvents: 'auto',
  userSelect: 'none',
};

const NAME_STYLE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  margin: '0 0 6px',
  lineHeight: 1.3,
};

const PRICE_STYLE: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#c0392b',
  margin: '0 0 10px',
  letterSpacing: '-0.5px',
};

const PRICE_CURRENCY_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  verticalAlign: 'super',
};

const DESC_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: '#444',
  margin: '0 0 14px',
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: '#999',
  margin: '0 0 14px',
};

const BUTTON_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 0',
  background: '#c0392b',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'center',
  textDecoration: 'none',
  letterSpacing: '0.5px',
  transition: 'background 0.15s ease, transform 0.1s ease',
};

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

export interface ProductCardProps {
  /** 表示する商品データ */
  product: ProductData;
  /** 「詳しく見る」ボタンクリックハンドラ（省略時は detailUrl へ遷移） */
  onDetailClick?: (product: ProductData) => void;
  /** カードの className（任意） */
  className?: string;
  /** カードの追加スタイル（任意） */
  style?: React.CSSProperties;
}

// ────────────────────────────────────────────────────────────────────────────
// ProductCard
// ────────────────────────────────────────────────────────────────────────────

/**
 * 商品情報カード。
 * 名前・価格・説明・「詳しく見る」ボタンを表示する。
 */
export function ProductCard({
  product,
  onDetailClick,
  className,
  style,
}: ProductCardProps): React.JSX.Element {
  const { name, price, currency = '¥', description, detailUrl, note } = product;

  const handleDetailClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onDetailClick) {
      onDetailClick(product);
    } else if (detailUrl) {
      window.location.href = detailUrl;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onDetailClick) {
        onDetailClick(product);
      } else if (detailUrl) {
        window.location.href = detailUrl;
      }
    }
  };

  return (
    <article
      className={className}
      style={{ ...CARD_STYLE, ...style }}
      role="article"
      aria-label={`商品: ${name}`}
      data-product-id={product.id}
    >
      {/* 商品名 */}
      <h3 style={NAME_STYLE}>{name}</h3>

      {/* 価格 */}
      <p style={PRICE_STYLE}>
        <span style={PRICE_CURRENCY_STYLE}>{currency}</span>
        {price.toLocaleString('ja-JP')}
        <span style={{ fontSize: 12, fontWeight: 500, color: '#888' }}> (税込)</span>
      </p>

      {/* 説明 */}
      <p style={DESC_STYLE}>{description}</p>

      {/* アレルゲン等の補足 */}
      {note && (
        <p style={NOTE_STYLE}>⚠️ {note}</p>
      )}

      {/* 「詳しく見る」ボタン（detailUrl または onDetailClick がある場合のみ表示） */}
      {(detailUrl || onDetailClick) && (
        <a
          href={detailUrl ?? '#'}
          style={BUTTON_STYLE}
          role="button"
          tabIndex={0}
          aria-label={`${name}の詳細を見る`}
          onClick={handleDetailClick}
          onKeyDown={handleKeyDown}
        >
          詳しく見る
        </a>
      )}
    </article>
  );
}
