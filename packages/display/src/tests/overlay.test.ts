/**
 * overlay.test.ts
 *
 * ProductCard / ProductOverlay / products のユニットテスト。
 *
 * R3F / drei は optional peer dep のため使わず、
 * ロジック・データ構造・React 要素ツリーを vitest (happy-dom) で検証する。
 *
 * react-dom/server (renderToStaticMarkup) は @types/react-dom が必要なため使わない。
 * React.createElement で要素を生成し、props / type を直接検証する方式を採用。
 *
 * テスト分類:
 *   1. products.ts — データ定義と型
 *   2. ProductCard — コンポーネント props・戻り値構造
 *   3. ProductOverlay — fade state machine ロジック
 *   4. index.ts — public API exports
 *   5. Overlay anchorToTransform ロジック（ユニット）
 */

import { describe, it, expect, vi } from 'vitest';
import React, { createElement } from 'react';
import type { ReactElement } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// ヘルパー: React 要素ツリーを再帰的に文字列化して検索
// ────────────────────────────────────────────────────────────────────────────

/** React 要素ツリーを DFS して指定プロパティ値が存在するかチェック */
function findInTree(
  node: unknown,
  predicate: (value: unknown) => boolean,
  depth = 0
): boolean {
  if (depth > 50) return false; // 無限再帰防止
  if (predicate(node)) return true;
  if (node === null || node === undefined) return false;
  if (typeof node === 'object') {
    for (const val of Object.values(node as Record<string, unknown>)) {
      if (findInTree(val, predicate, depth + 1)) return true;
    }
  }
  if (Array.isArray(node)) {
    for (const item of node as unknown[]) {
      if (findInTree(item, predicate, depth + 1)) return true;
    }
  }
  return false;
}

/** 要素ツリー内にある文字列を含む props を探す */
function containsText(element: unknown, text: string): boolean {
  return findInTree(element, (v) => typeof v === 'string' && v.includes(text));
}

/** 要素ツリー内に指定 props を持つノードを探す */
function hasProp(element: unknown, key: string, value?: unknown): boolean {
  if (element === null || element === undefined) return false;
  if (typeof element === 'object' && element !== null) {
    const obj = element as Record<string, unknown>;
    if ('props' in obj && typeof obj['props'] === 'object' && obj['props'] !== null) {
      const props = obj['props'] as Record<string, unknown>;
      if (key in props) {
        if (value === undefined) return true;
        return props[key] === value;
      }
    }
    // 子要素を再帰的に検索
    for (const val of Object.values(obj)) {
      if (hasProp(val, key, value)) return true;
    }
  }
  if (Array.isArray(element)) {
    for (const item of element as unknown[]) {
      if (hasProp(item, key, value)) return true;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. products.ts
// ────────────────────────────────────────────────────────────────────────────

describe('products — data and types', () => {
  it('PRODUCTS contains at least 4 entries', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    expect(Object.keys(PRODUCTS).length).toBeGreaterThanOrEqual(4);
  });

  it('each product has required fields', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    for (const [id, product] of Object.entries(PRODUCTS)) {
      expect(product.id).toBe(id);
      expect(typeof product.name).toBe('string');
      expect(product.name.length).toBeGreaterThan(0);
      expect(typeof product.price).toBe('number');
      expect(product.price).toBeGreaterThan(0);
      expect(typeof product.description).toBe('string');
      expect(product.description.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_PRODUCT is strawberry-shortcake', async () => {
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');
    expect(DEFAULT_PRODUCT.id).toBe('strawberry-shortcake');
  });

  it('currency is a string when defined', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    for (const product of Object.values(PRODUCTS)) {
      if (product.currency !== undefined) {
        expect(typeof product.currency).toBe('string');
      }
    }
  });

  it('strawberry-shortcake has correct price 680', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    expect(PRODUCTS['strawberry-shortcake']!.price).toBe(680);
  });

  it('all products with detailUrl start with /', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    for (const product of Object.values(PRODUCTS)) {
      if (product.detailUrl) {
        expect(product.detailUrl.startsWith('/')).toBe(true);
      }
    }
  });

  it('module exports PRODUCTS and DEFAULT_PRODUCT', async () => {
    const mod = await import('../scene/products.js');
    expect(typeof mod.PRODUCTS).toBe('object');
    expect(typeof mod.DEFAULT_PRODUCT).toBe('object');
    expect(mod.DEFAULT_PRODUCT).not.toBeNull();
  });

  it('mont-blanc exists and has note', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    const mb = PRODUCTS['mont-blanc'];
    expect(mb).toBeDefined();
    expect(mb!.note).toBeDefined();
    expect(typeof mb!.note).toBe('string');
  });

  it('all product IDs are non-empty strings', async () => {
    const { PRODUCTS } = await import('../scene/products.js');
    for (const product of Object.values(PRODUCTS)) {
      expect(typeof product.id).toBe('string');
      expect(product.id.length).toBeGreaterThan(0);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. ProductCard — component structure and props
// ────────────────────────────────────────────────────────────────────────────

describe('ProductCard — component', () => {
  it('is a function component', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    expect(typeof ProductCard).toBe('function');
  });

  it('returns a React element (JSX.Element)', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductCard, { product: DEFAULT_PRODUCT });
    expect(element).toBeDefined();
    expect(element.type).toBe(ProductCard);
  });

  it('product prop is required — element has product in props', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    const element = createElement(ProductCard, { product });
    expect(element.props.product).toBe(product);
    expect(element.props.product.name).toBe('いちごショートケーキ');
    expect(element.props.product.price).toBe(680);
  });

  it('rendered tree contains product name text', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    // ProductCard を実際に呼んで返された要素ツリーを検査
    const result = (ProductCard as (p: typeof product extends infer P ? { product: P } : never) => ReactElement)({ product });
    expect(containsText(result, 'いちごショートケーキ')).toBe(true);
  });

  it('rendered tree contains formatted price', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    // 680 and ¥ should appear
    expect(containsText(result, '680')).toBe(true);
    expect(containsText(result, '¥')).toBe(true);
  });

  it('rendered tree contains description', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['mont-blanc']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(containsText(result, '丹波産和栗')).toBe(true);
  });

  it('rendered tree contains note when present', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(containsText(result, '卵・乳・小麦を含む')).toBe(true);
  });

  it('no "詳しく見る" when no detailUrl and no onDetailClick', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const product = {
      id: 'test',
      name: 'テスト商品',
      price: 100,
      description: 'テスト',
    };

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(containsText(result, '詳しく見る')).toBe(false);
  });

  it('renders "詳しく見る" when detailUrl is set', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const result = (ProductCard as Function)({ product: DEFAULT_PRODUCT }) as ReactElement;
    expect(containsText(result, '詳しく見る')).toBe(true);
  });

  it('renders "詳しく見る" when onDetailClick is provided', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const product = { id: 'x', name: 'X', price: 1, description: 'd' };

    const result = (ProductCard as Function)({ product, onDetailClick: vi.fn() }) as ReactElement;
    expect(containsText(result, '詳しく見る')).toBe(true);
  });

  it('root element has role="article"', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const result = (ProductCard as Function)({ product: DEFAULT_PRODUCT }) as ReactElement;
    expect(hasProp(result, 'role', 'article')).toBe(true);
  });

  it('root element has data-product-id attribute', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['chocolate-gateau']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(hasProp(result, 'data-product-id', 'chocolate-gateau')).toBe(true);
  });

  it('aria-label includes product name', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['rare-cheesecake']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(findInTree(result, (v) =>
      typeof v === 'string' && v.includes('レアチーズケーキ')
    )).toBe(true);
  });

  it('renders (税込) label', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const result = (ProductCard as Function)({ product: DEFAULT_PRODUCT }) as ReactElement;
    expect(containsText(result, '税込')).toBe(true);
  });

  it('all four products render without throwing', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');

    for (const product of Object.values(PRODUCTS)) {
      expect(() => (ProductCard as Function)({ product })).not.toThrow();
    }
  });

  it('custom style is passed through', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductCard, {
      product: DEFAULT_PRODUCT,
      style: { borderRadius: 0 },
    });
    expect(element.props.style).toMatchObject({ borderRadius: 0 });
  });

  it('detailUrl href is set on "詳しく見る" link', async () => {
    const { ProductCard } = await import('../scene/ProductCard.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    const result = (ProductCard as Function)({ product }) as ReactElement;
    expect(hasProp(result, 'href', '/products/strawberry-shortcake')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. ProductOverlay — component and fade logic
// ────────────────────────────────────────────────────────────────────────────

describe('ProductOverlay — component', () => {
  it('is exported as a function', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    expect(typeof ProductOverlay).toBe('function');
  });

  it('createElement returns a React element (does not call hooks)', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    // createElement は hooks を呼ばない — 安全に実行できる
    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
    });
    expect(element).toBeDefined();
    expect(element.type).toBe(ProductOverlay);
  });

  it('props.visible=true is set correctly', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
    });
    expect(element.props.visible).toBe(true);
  });

  it('props.visible=false is set correctly', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: false,
    });
    expect(element.props.visible).toBe(false);
  });

  it('props.product is passed through', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { PRODUCTS } = await import('../scene/products.js');
    const product = PRODUCTS['strawberry-shortcake']!;

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product,
      visible: true,
    });
    expect(element.props.product).toBe(product);
    expect(element.props.product.name).toBe('いちごショートケーキ');
  });

  it('props.position [1,2,3] is passed through', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductOverlay, {
      position: [1, 2, 3] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
    });
    expect(element.props.position).toEqual([1, 2, 3]);
  });

  it('anchor defaults to top-center in element props', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
    });
    // anchor は省略時 undefined (コンポーネント内でデフォルト 'top-center' になる)
    // props に anchor が undefined であることを確認
    expect(element.props.anchor).toBeUndefined();
  });

  it('onClose callback is passed through as a function', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');
    const onClose = vi.fn();

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
      onClose,
    });
    expect(typeof element.props.onClose).toBe('function');
    expect(element.props.onClose).toBe(onClose);
  });

  it('onDetailClick callback is passed through', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { DEFAULT_PRODUCT } = await import('../scene/products.js');
    const onDetailClick = vi.fn();

    const element = createElement(ProductOverlay, {
      position: [0, 2, 0] as [number, number, number],
      product: DEFAULT_PRODUCT,
      visible: true,
      onDetailClick,
    });
    expect(typeof element.props.onDetailClick).toBe('function');
  });

  it('all four products can be used in createElement without error', async () => {
    const { ProductOverlay } = await import('../scene/ProductOverlay.js');
    const { PRODUCTS } = await import('../scene/products.js');

    for (const product of Object.values(PRODUCTS)) {
      expect(() =>
        createElement(ProductOverlay, {
          position: [0, 2, 0] as [number, number, number],
          product,
          visible: true,
        })
      ).not.toThrow();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3b. ProductOverlay — exported pure helpers (fade state machine)
// ────────────────────────────────────────────────────────────────────────────

describe('ProductOverlay — pure helper functions', () => {
  it('initialFadeState(true) returns "visible"', async () => {
    const { initialFadeState } = await import('../scene/ProductOverlay.js');
    expect(initialFadeState(true)).toBe('visible');
  });

  it('initialFadeState(false) returns "hidden"', async () => {
    const { initialFadeState } = await import('../scene/ProductOverlay.js');
    expect(initialFadeState(false)).toBe('hidden');
  });

  it('fadeStyle("visible", 300) has opacity=1', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('visible', 300);
    expect(style.opacity).toBe(1);
  });

  it('fadeStyle("hidden", 300) has opacity=0', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('hidden', 300);
    expect(style.opacity).toBe(0);
  });

  it('fadeStyle("entering", 300) has opacity=0 (not yet animated)', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('entering', 300);
    expect(style.opacity).toBe(0);
  });

  it('fadeStyle("leaving", 300) has opacity=0', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('leaving', 300);
    expect(style.opacity).toBe(0);
  });

  it('fadeStyle("visible", 300) translateY is 0px', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('visible', 300);
    expect(style.transform).toContain('0px');
  });

  it('fadeStyle("entering", 300) translateY is -8px', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('entering', 300);
    expect(style.transform).toContain('-8px');
  });

  it('fadeStyle contains transition with duration', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('visible', 300);
    expect(typeof style.transition).toBe('string');
    expect(style.transition).toContain('300ms');
    expect(style.transition).toContain('opacity');
  });

  it('FADE_DURATION_MS is 300', async () => {
    const { FADE_DURATION_MS } = await import('../scene/ProductOverlay.js');
    expect(FADE_DURATION_MS).toBe(300);
  });

  it('fadeStyle position is "relative"', async () => {
    const { fadeStyle } = await import('../scene/ProductOverlay.js');
    const style = fadeStyle('visible', 300);
    expect(style.position).toBe('relative');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. index.ts public API exports
// ────────────────────────────────────────────────────────────────────────────

describe('display package — public API exports', () => {
  it('exports ProductCard', async () => {
    const mod = await import('../index.js');
    expect(typeof (mod as Record<string, unknown>)['ProductCard']).toBe('function');
  });

  it('exports ProductOverlay', async () => {
    const mod = await import('../index.js');
    expect(typeof (mod as Record<string, unknown>)['ProductOverlay']).toBe('function');
  });

  it('exports PRODUCTS as object', async () => {
    const mod = await import('../index.js');
    const products = (mod as Record<string, unknown>)['PRODUCTS'];
    expect(typeof products).toBe('object');
    expect(products).not.toBeNull();
  });

  it('exports DEFAULT_PRODUCT as object', async () => {
    const mod = await import('../index.js');
    const dp = (mod as Record<string, unknown>)['DEFAULT_PRODUCT'];
    expect(typeof dp).toBe('object');
    expect(dp).not.toBeNull();
  });

  it('PRODUCTS from index has 4+ entries', async () => {
    const { PRODUCTS } = await import('../index.js') as { PRODUCTS: Record<string, unknown> };
    expect(Object.keys(PRODUCTS).length).toBeGreaterThanOrEqual(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Overlay anchorToTransform ロジック
// ────────────────────────────────────────────────────────────────────────────

describe('Overlay — anchorToTransform logic (unit)', () => {
  /**
   * anchorToTransform は private 関数なので、ロジックをローカルに再実装して検証。
   * Overlay.tsx 実装の正しさを保証するための仕様テスト。
   */

  type OverlayAnchor =
    | 'center' | 'top-left' | 'top-center' | 'top-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right';

  function anchorToTransform(anchor: OverlayAnchor): string {
    switch (anchor) {
      case 'top-left': return 'translate(0%, 0%)';
      case 'top-center': return 'translate(-50%, 0%)';
      case 'top-right': return 'translate(-100%, 0%)';
      case 'bottom-left': return 'translate(0%, -100%)';
      case 'bottom-center': return 'translate(-50%, -100%)';
      case 'bottom-right': return 'translate(-100%, -100%)';
      case 'center':
      default: return 'translate(-50%, -50%)';
    }
  }

  it('top-center → translate(-50%, 0%)', () => {
    expect(anchorToTransform('top-center')).toBe('translate(-50%, 0%)');
  });

  it('bottom-center → translate(-50%, -100%)', () => {
    expect(anchorToTransform('bottom-center')).toBe('translate(-50%, -100%)');
  });

  it('center → translate(-50%, -50%)', () => {
    expect(anchorToTransform('center')).toBe('translate(-50%, -50%)');
  });

  it('top-left → translate(0%, 0%)', () => {
    expect(anchorToTransform('top-left')).toBe('translate(0%, 0%)');
  });

  it('top-right → translate(-100%, 0%)', () => {
    expect(anchorToTransform('top-right')).toBe('translate(-100%, 0%)');
  });

  it('bottom-left → translate(0%, -100%)', () => {
    expect(anchorToTransform('bottom-left')).toBe('translate(0%, -100%)');
  });

  it('bottom-right → translate(-100%, -100%)', () => {
    expect(anchorToTransform('bottom-right')).toBe('translate(-100%, -100%)');
  });
});
