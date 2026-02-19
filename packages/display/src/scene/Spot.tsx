/**
 * Spot.tsx
 *
 * クリック・ホバー可能な 3D オブジェクトのラッパーコンポーネント。
 * highlight（outline / glow / scale / color / none）と
 * オプショナルな tooltip を提供する。
 *
 * 使い方:
 *   <Spot to="/products" highlight="outline" tooltip="商品を見る">
 *     <mesh><boxGeometry /><meshStandardMaterial /></mesh>
 *   </Spot>
 */
import React, { useState, useCallback } from 'react';
import type { SpotProps } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// ハイライト実装（スケールで代替。outline/glow は drei Selection で実装可能）
// ────────────────────────────────────────────────────────────────────────────

function getHoverScale(highlight: SpotProps['highlight']): number {
  switch (highlight) {
    case 'scale':
      return 1.08;
    case 'outline':
    case 'glow':
    case 'color':
      return 1.02; // わずかなスケールアップ
    case 'none':
    default:
      return 1.0;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Spot
// ────────────────────────────────────────────────────────────────────────────

export function Spot({
  to,
  highlight = 'outline',
  tooltip,
  onClick,
  onHover,
  disabled = false,
  children,
}: SpotProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback((): void => {
    if (disabled) return;
    onClick?.();
    if (to) {
      // react-router-dom の useNavigate が使えない場合は hash fallback
      // 利用側は onClick で navigate() を呼ぶことを推奨
      window.location.hash = to;
    }
  }, [disabled, onClick, to]);

  const handlePointerEnter = useCallback((): void => {
    if (disabled) return;
    setHovered(true);
    onHover?.(true);
  }, [disabled, onHover]);

  const handlePointerLeave = useCallback((): void => {
    setHovered(false);
    onHover?.(false);
  }, [onHover]);

  const scale = hovered && !disabled ? getHoverScale(highlight) : 1.0;
  const cursor = disabled ? 'default' : 'pointer';

  return (
    <div
      data-spot-highlight={highlight}
      data-spot-to={to}
      style={{
        display: 'contents',
        transform: `scale(${scale})`,
        cursor,
        outline: hovered && highlight === 'outline' && !disabled
          ? '2px solid #00aaff'
          : undefined,
        filter: hovered && highlight === 'glow' && !disabled
          ? 'drop-shadow(0 0 8px #00aaff)'
          : undefined,
        transition: 'transform 0.15s ease, filter 0.15s ease',
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={tooltip}
      onClick={handleClick}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
    >
      {children as React.ReactNode}
      {tooltip && hovered && !disabled && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}
