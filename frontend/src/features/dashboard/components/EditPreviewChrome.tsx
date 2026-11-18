import type { CSSProperties, ReactNode } from 'react';
import { FONT_FAMILY_PRIMARY } from '../../../styles/tokens';

export const editPreviewTextStyle: CSSProperties = {
  opacity: 0.82,
  fontStyle: 'italic',
};

const outlineStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: '1px dashed rgba(173, 70, 255, 0.45)',
  borderRadius: 4,
  background: 'rgba(142, 81, 255, 0.04)',
  pointerEvents: 'none',
  zIndex: 8,
  boxSizing: 'border-box',
};

/** 編輯模式：無資料時的虛線外框 + 角標 */
export function WidgetEditPreviewOutline({
  active,
  label,
  children,
}: {
  active?: boolean;
  label?: string;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {children}
      <div style={outlineStyle}>
        {label && (
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: 5,
              fontSize: 9,
              fontFamily: FONT_FAMILY_PRIMARY,
              fontWeight: 700,
              color: 'rgba(196, 180, 255, 0.95)',
              letterSpacing: '0.03em',
            }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** 折線／長條圖編輯預覽骨架 */
export function ChartEditSkeleton({ label, variant = 'line' }: { label: string; variant?: 'line' | 'bar' }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      <svg width="100%" height="60%" viewBox="0 0 200 80" preserveAspectRatio="none" style={{ opacity: 0.35 }}>
        {variant === 'bar' ? (
          <>
            <rect x="20" y="40" width="24" height="35" fill="#FD9A00" rx="2" />
            <rect x="56" y="25" width="24" height="50" fill="#FFBA00" rx="2" />
            <rect x="92" y="15" width="24" height="60" fill="#FD9A00" rx="2" />
            <rect x="128" y="30" width="24" height="45" fill="#E17100" rx="2" />
            <rect x="164" y="20" width="24" height="55" fill="#FFBA00" rx="2" />
          </>
        ) : (
          <polyline
            points="0,60 40,45 80,50 120,20 160,35 200,10"
            fill="none"
            stroke="#00B8DB"
            strokeWidth="2.5"
          />
        )}
        <line x1="0" y1="75" x2="200" y2="75" stroke="rgba(144, 161, 185, 0.3)" strokeWidth="1" />
      </svg>
      <span style={{ fontSize: 10, color: 'rgba(196, 180, 255, 0.85)', fontFamily: FONT_FAMILY_PRIMARY, fontStyle: 'italic' }}>
        {label}
      </span>
    </div>
  );
}

