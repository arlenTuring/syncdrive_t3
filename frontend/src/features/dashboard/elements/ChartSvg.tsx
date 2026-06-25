import type { ReactNode } from 'react';

/** 繪圖區貼齊元件外框：viewBox 用邏輯座標，顯示用 100% 填滿容器 */
export function ChartSvg({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  );
}
