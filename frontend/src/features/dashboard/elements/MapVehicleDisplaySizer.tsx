import { useCallback, useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { VehicleDefinitionMapView } from '../../vehicle-editor/elements/VehicleDefinitionMapView';
import type { VehicleDefinition } from '../../vehicle-editor/types';

const MIN_W = 24;
const MIN_H = 6;
const LABEL_H = 20;

/** 儀表板圖台編輯：可拖曳縮放的載具顯示校準元件（地圖像素座標） */
export function MapVehicleDisplaySizer({
  definition,
  widthPx,
  heightPx,
  liveData,
  overlayOnly = false,
  lockPosition = true,
  onSizeChange,
}: {
  definition: VehicleDefinition;
  widthPx: number;
  heightPx: number;
  liveData?: Record<string, unknown>;
  /** true：載具由同層繪製，此元件僅提供選取／縮放框 */
  overlayOnly?: boolean;
  /** 鎖定位置（跟隨地圖上載具，僅允許縮放） */
  lockPosition?: boolean;
  onSizeChange: (width: number, height: number) => void;
}) {
  const [liveW, setLiveW] = useState(widthPx);
  const [liveH, setLiveH] = useState(heightPx);
  const resizingRef = useRef(false);

  useEffect(() => {
    if (!resizingRef.current) {
      setLiveW(widthPx);
      setLiveH(heightPx);
    }
  }, [widthPx, heightPx]);

  const commitSize = useCallback(
    (w: number, h: number) => {
      resizingRef.current = false;
      const nextW = Math.max(MIN_W, Math.round(w));
      const nextH = Math.max(MIN_H, Math.round(h));
      setLiveW(nextW);
      setLiveH(nextH);
      if (nextW !== widthPx || nextH !== heightPx) {
        onSizeChange(nextW, nextH);
      }
    },
    [widthPx, heightPx, onSizeChange],
  );

  return (
    <div
      className="pointer-events-auto relative"
      style={{ width: liveW, height: liveH }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="pointer-events-none absolute left-0 z-[2]"
        style={{ top: -LABEL_H, width: liveW, height: LABEL_H }}
      >
        <div className="truncate border border-cyan-500/30 bg-cyan-950/90 px-2 py-0.5 text-[9px] font-medium text-cyan-300">
          載具顯示 · {liveW}×{liveH} px · 拖角調整
        </div>
      </div>
      <Rnd
        className="pointer-events-auto"
        size={{ width: liveW, height: liveH }}
        position={{ x: 0, y: 0 }}
        disableDragging={lockPosition}
        minWidth={MIN_W}
        minHeight={MIN_H}
        maxWidth={480}
        maxHeight={120}
        enableResizing={{
          top: false,
          right: true,
          bottom: true,
          left: false,
          topRight: true,
          bottomRight: true,
          bottomLeft: false,
          topLeft: false,
        }}
        resizeHandleStyles={{
          bottomRight: {
            width: 10,
            height: 10,
            right: -3,
            bottom: -3,
            background: '#22d3ee',
            borderRadius: 2,
            border: '1px solid #fff',
            zIndex: 10,
          },
          right: {
            width: 6,
            right: -3,
            background: '#22d3ee88',
            borderRadius: 1,
          },
          bottom: {
            height: 6,
            bottom: -3,
            background: '#22d3ee88',
            borderRadius: 1,
          },
          topRight: {
            width: 8,
            height: 8,
            right: -3,
            top: -3,
            background: '#22d3ee',
            borderRadius: 2,
            border: '1px solid #fff',
          },
        }}
        onResizeStart={() => {
          resizingRef.current = true;
        }}
        onResize={(_e, _dir, ref) => {
          setLiveW(ref.offsetWidth);
          setLiveH(ref.offsetHeight);
        }}
        onResizeStop={(_e, _dir, ref) => {
          commitSize(ref.offsetWidth, ref.offsetHeight);
        }}
        style={{
          border: '2px dashed rgba(34,211,238,0.75)',
          background: overlayOnly ? 'rgba(34,211,238,0.06)' : 'rgba(2,6,23,0.55)',
          boxShadow: '0 0 0 1px rgba(34,211,238,0.2)',
          position: 'absolute',
          left: 0,
          top: 0,
        }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {!overlayOnly ? (
            <VehicleDefinitionMapView
              definition={definition}
              liveData={liveData}
              displayWidth={liveW}
              displayHeight={liveH}
            />
          ) : (
            <div
              className="h-full w-full cursor-se-resize"
              title="拖曳角落以調整載具顯示尺寸"
              aria-label="載具顯示校準框"
            />
          )}
        </div>
      </Rnd>
    </div>
  );
}
