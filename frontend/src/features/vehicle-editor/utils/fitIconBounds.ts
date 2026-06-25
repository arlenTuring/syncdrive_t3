export interface IconContentMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** object-contain 後圖示在容器內的實際顯示尺寸 */
export function containedIconSize(
  boxW: number,
  boxH: number,
  naturalW: number,
  naturalH: number,
): { width: number; height: number } {
  if (boxW <= 0 || boxH <= 0 || naturalW <= 0 || naturalH <= 0) {
    return { width: Math.max(1, boxW), height: Math.max(1, boxH) };
  }
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
  };
}

export function iconContentMetrics(
  boxW: number,
  boxH: number,
  naturalW: number,
  naturalH: number,
): IconContentMetrics {
  const { width, height } = containedIconSize(boxW, boxH, naturalW, naturalH);
  return {
    x: Math.round((boxW - width) / 2),
    y: Math.round((boxH - height) / 2),
    width,
    height,
  };
}

/** 將元件外框縮至與圖示貼齊（移除 object-contain 留白） */
export interface ImageAlphaBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  naturalWidth: number;
  naturalHeight: number;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** 掃描非透明像素邊界（車燈光暈等 PNG 去空白用） */
export async function loadImageAlphaBounds(
  url: string,
  alphaMin = 12,
): Promise<ImageAlphaBounds | null> {
  const img = await loadImage(url);
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let left = w;
  let top = h;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a >= alphaMin) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) return null;
  return { left, top, right, bottom, naturalWidth: w, naturalHeight: h };
}

export function visibleAlphaContentMetrics(
  boxW: number,
  boxH: number,
  bounds: ImageAlphaBounds,
): IconContentMetrics {
  const visW = bounds.right - bounds.left + 1;
  const visH = bounds.bottom - bounds.top + 1;
  const { width: dispW, height: dispH } = containedIconSize(
    boxW,
    boxH,
    bounds.naturalWidth,
    bounds.naturalHeight,
  );
  const sx = dispW / bounds.naturalWidth;
  const sy = dispH / bounds.naturalHeight;
  const baseX = (boxW - dispW) / 2;
  const baseY = (boxH - dispH) / 2;
  return {
    x: Math.round(baseX + bounds.left * sx),
    y: Math.round(baseY + bounds.top * sy),
    width: Math.max(1, Math.round(visW * sx)),
    height: Math.max(1, Math.round(visH * sy)),
  };
}

/** 可視區域填滿元件框（裁切 PNG 空白） */
export function visibleAlphaCropStyle(
  boxW: number,
  boxH: number,
  bounds: ImageAlphaBounds,
): { left: number; top: number; width: number; height: number } {
  const nw = bounds.naturalWidth;
  const nh = bounds.naturalHeight;
  const visW = (bounds.right - bounds.left + 1) / nw;
  const visH = (bounds.bottom - bounds.top + 1) / nh;
  const imgW = boxW / visW;
  const imgH = boxH / visH;
  return {
    left: -(bounds.left / nw) * imgW,
    top: -(bounds.top / nh) * imgH,
    width: imgW,
    height: imgH,
  };
}

export function fitElementSizeToImage(
  boxW: number,
  boxH: number,
  naturalW: number,
  naturalH: number,
): { width: number; height: number } {
  return containedIconSize(boxW, boxH, naturalW, naturalH);
}

export function loadImageNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return loadImage(url).then((img) => ({
    width: img.naturalWidth || 1,
    height: img.naturalHeight || 1,
  }));
}
