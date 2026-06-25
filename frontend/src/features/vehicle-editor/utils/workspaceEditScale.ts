export const WORKSPACE_FIT_PAD_PX = 80;

/** 圖台等窄橫向畫布：邏輯尺寸小，編輯時需額外放大才方便操作 */
export function isCompactVehicleCanvas(width: number, height: number): boolean {
  return width <= 80 || height <= 24 || width * height <= 2500;
}

export function computeWorkspaceFitScale(
  containerWidth: number,
  containerHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  pad = WORKSPACE_FIT_PAD_PX,
): number {
  const sw = Math.max(1, containerWidth - pad) / Math.max(1, canvasWidth);
  const sh = Math.max(1, containerHeight - pad) / Math.max(1, canvasHeight);
  const fitToContainer = Math.min(sw, sh);

  if (!isCompactVehicleCanvas(canvasWidth, canvasHeight)) {
    return Math.min(fitToContainer, 4);
  }

  const MIN_DISPLAY_W = 560;
  const MIN_DISPLAY_H = 160;
  const comfortScale = Math.min(
    MIN_DISPLAY_W / canvasWidth,
    MIN_DISPLAY_H / canvasHeight,
  );
  const target = Math.max(fitToContainer * 0.88, comfortScale);
  return Math.min(Math.max(target, comfortScale), 40);
}

export function workspaceGridStepPx(canvasWidth: number, canvasHeight: number): number {
  const minDim = Math.min(canvasWidth, canvasHeight);
  if (minDim <= 12) return 1;
  if (minDim <= 30) return 5;
  return 10;
}
