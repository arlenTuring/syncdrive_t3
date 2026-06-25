import { ChevronLeft, ChevronRight, RotateCcw, RotateCw } from 'lucide-react';
import { normalizeDegrees } from '../../map-editor/utils/rotation';

export function VehicleRotationToolbar({
  rotationDeg,
  screenScale = 1,
  variant = 'overlay',
  onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
}: {
  rotationDeg: number;
  /** 畫布縮放倍率，用於固定工具列螢幕尺寸 */
  screenScale?: number;
  variant?: 'overlay' | 'inline';
  onRotateLeft90: () => void;
  onRotateRight90: () => void;
  onRotateDelta: (delta: number) => void;
}) {
  const angleLabel = `${normalizeDegrees(rotationDeg).toFixed(0)}°`;
  const inv = screenScale > 0 ? 1 / screenScale : 1;

  const toolbar = (
      <div
        className="flex items-center gap-1.5 rounded-full border border-zinc-500/90 bg-zinc-900/98 px-2 py-1.5 shadow-xl ring-1 ring-cyan-500/30"
        role="toolbar"
        aria-label="旋轉"
      >
        <button
          type="button"
          title="向左轉 90°"
          onClick={onRotateLeft90}
          className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          title="向右轉 90°"
          onClick={onRotateRight90}
          className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
        >
          <RotateCw className="size-4" aria-hidden />
        </button>
        <span className="mx-0.5 min-w-[2rem] text-center font-mono text-xs leading-none text-cyan-400/90">
          {angleLabel}
        </span>
        <button
          type="button"
          title="微調 -5°"
          onClick={() => onRotateDelta(-5)}
          className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          title="微調 +5°"
          onClick={() => onRotateDelta(5)}
          className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
  );

  if (variant === 'inline') {
    return (
      <div data-vehicle-rotation-toolbar onPointerDown={(e) => e.stopPropagation()}>
        {toolbar}
      </div>
    );
  }

  return (
    <div
      data-vehicle-rotation-toolbar
      className="pointer-events-none absolute z-[60] flex flex-col items-center pt-1"
      style={{
        left: '50%',
        top: '100%',
        transform: `translateX(-50%) scale(${inv})`,
        transformOrigin: 'top center',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-auto">{toolbar}</div>
    </div>
  );
}
