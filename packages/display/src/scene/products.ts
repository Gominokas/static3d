/**
 * products.ts
 *
 * ショーケース商品データの型定義とサンプルデータ。
 *
 * 将来的には CMS / API から取得する想定。
 * 現在は静的 JSON として定義する。
 *
 * 使い方:
 *   import { PRODUCTS, type ProductData } from './products.js';
 *   const cake = PRODUCTS['strawberry-shortcake'];
 */

// ────────────────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────────────────

/** 商品データ */
export interface ProductData {
  /** 商品 ID（manifest のキーと対応） */
  id: string;
  /** 表示名 */
  name: string;
  /** 価格（円） */
  price: number;
  /** 通貨記号（デフォルト: '¥'） */
  currency?: string;
  /** 短い説明（1〜2 文） */
  description: string;
  /** 「詳しく見る」ボタンのリンク先 URL（省略時はボタン非表示） */
  detailUrl?: string;
  /** アレルゲン情報などの補足（任意） */
  note?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// サンプルデータ（将来は CMS/API に差し替える）
// ────────────────────────────────────────────────────────────────────────────

/**
 * ショーケース商品マスタ。
 * キー: 商品 ID
 */
export const PRODUCTS: Record<string, ProductData> = {
  'strawberry-shortcake': {
    id: 'strawberry-shortcake',
    name: 'いちごショートケーキ',
    price: 680,
    currency: '¥',
    description:
      'ふんわりスポンジに生クリームと国産いちごをたっぷりのせた定番ショートケーキ。',
    detailUrl: '/products/strawberry-shortcake',
    note: '卵・乳・小麦を含む',
  },
  'mont-blanc': {
    id: 'mont-blanc',
    name: 'モンブラン',
    price: 750,
    currency: '¥',
    description:
      '丹波産和栗を贅沢に使ったモンブラン。ほろ苦いメレンゲとの相性が絶妙。',
    detailUrl: '/products/mont-blanc',
    note: '卵・乳・小麦・くるみを含む',
  },
  'chocolate-gateau': {
    id: 'chocolate-gateau',
    name: 'ガトーショコラ',
    price: 820,
    currency: '¥',
    description:
      'ベルギー産チョコレートを使った濃厚ガトーショコラ。深みのあるビター感が特徴。',
    detailUrl: '/products/chocolate-gateau',
    note: '卵・乳・小麦を含む',
  },
  'rare-cheesecake': {
    id: 'rare-cheesecake',
    name: 'レアチーズケーキ',
    price: 620,
    currency: '¥',
    description:
      'クリームチーズとヨーグルトの軽やかなレアチーズケーキ。さっぱりとした後味。',
    detailUrl: '/products/rare-cheesecake',
    note: '卵・乳・小麦を含む',
  },
};

/** デフォルト商品（未指定の場合に使用） */
export const DEFAULT_PRODUCT: ProductData = PRODUCTS['strawberry-shortcake']!;
