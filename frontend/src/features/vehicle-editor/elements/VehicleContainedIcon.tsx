import { useEffect, useRef, useState } from 'react';
import type { IconContentMetrics, ImageAlphaBounds } from '../utils/fitIconBounds';
import {
  containedIconSize,
  iconContentMetrics,
  loadImage,
  loadImageAlphaBounds,
  visibleAlphaContentMetrics,
} from '../utils/fitIconBounds';

export function VehicleContainedIcon({
  src,
  boxWidth,
  boxHeight,
  className,
  fitVisibleAlpha = false,
  onMetrics,
}: {
  src: string;
  boxWidth: number;
  boxHeight: number;
  className?: string;
  /** 依非透明像素裁切空白（車燈 PNG） */
  fitVisibleAlpha?: boolean;
  onMetrics?: (metrics: IconContentMetrics | null) => void;
}) {
  const [alphaBounds, setAlphaBounds] = useState<ImageAlphaBounds | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [layout, setLayout] = useState<IconContentMetrics | null>(null);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  /** 僅 src 變更時載入圖片／alpha 邊界，避免縮放時重載造成跳動 */
  useEffect(() => {
    let cancelled = false;
    setAlphaBounds(null);
    setNatural(null);
    setLayout(null);

    if (fitVisibleAlpha) {
      loadImageAlphaBounds(src)
        .then((bounds) => {
          if (cancelled) return;
          setAlphaBounds(bounds);
        })
        .catch(() => {
          if (!cancelled) setAlphaBounds(null);
        });
      return () => {
        cancelled = true;
      };
    }

    loadImage(src)
      .then((img) => {
        if (cancelled) return;
        setNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      })
      .catch(() => {
        if (!cancelled) setNatural(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src, fitVisibleAlpha]);

  /** 依容器尺寸更新 metrics（不觸發重載） */
  useEffect(() => {
    if (fitVisibleAlpha) {
      if (!alphaBounds) {
        onMetricsRef.current?.(null);
        setLayout(null);
        return;
      }
      const metrics = visibleAlphaContentMetrics(boxWidth, boxHeight, alphaBounds);
      setLayout(metrics);
      onMetricsRef.current?.(metrics);
      return;
    }

    if (!natural) {
      onMetricsRef.current?.(null);
      setLayout(null);
      return;
    }
    const metrics = iconContentMetrics(boxWidth, boxHeight, natural.w, natural.h);
    setLayout(metrics);
    onMetricsRef.current?.(metrics);
  }, [boxWidth, boxHeight, fitVisibleAlpha, alphaBounds, natural]);

  if (fitVisibleAlpha) {
    if (!alphaBounds || !layout) {
      return (
        <img
          src={src}
          alt=""
          className={className}
          style={{ width: boxWidth, height: boxHeight, opacity: 0 }}
          draggable={false}
          aria-hidden
        />
      );
    }
    const { width: dispW, height: dispH } = containedIconSize(
      boxWidth,
      boxHeight,
      alphaBounds.naturalWidth,
      alphaBounds.naturalHeight,
    );
    const baseX = (boxWidth - dispW) / 2;
    const baseY = (boxHeight - dispH) / 2;
    return (
      <img
        src={src}
        alt=""
        className={className}
        draggable={false}
        aria-hidden
        style={{
          position: 'absolute',
          left: baseX,
          top: baseY,
          width: dispW,
          height: dispH,
        }}
      />
    );
  }

  if (!layout || !natural) {
    return (
      <img
        src={src}
        alt=""
        className={className}
        style={{ width: boxWidth, height: boxHeight, opacity: 0 }}
        draggable={false}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={className}
      draggable={false}
      style={{
        position: 'absolute',
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    />
  );
}
