export type GaugeContentPadding = Partial<{ top: number; right: number; bottom: number; left: number }>;

function resolveGaugePadding(p?: GaugeContentPadding) {
  return {
    top: Math.max(0, p?.top ?? 0),
    right: Math.max(0, p?.right ?? 0),
    bottom: Math.max(0, p?.bottom ?? 0),
    left: Math.max(0, p?.left ?? 0),
  };
}

/** 依元件寬高計算半圓儀表幾何（橢圓弧）；可設定內距縮小繪製區 */
export function computeVehicleStatusGaugeLayout(
  panelW: number,
  panelH: number,
  valueFsBase: number,
  unitFsBase: number,
  arcStrokeOverride?: number,
  contentPadding?: GaugeContentPadding,
  textGap = 0,
) {
  const pad = resolveGaugePadding(contentPadding);
  const w = Math.max(24, panelW);
  const h = Math.max(28, panelH);
  const innerW = Math.max(8, w - pad.left - pad.right);
  const innerH = Math.max(8, h - pad.top - pad.bottom);
  const autoStroke = Math.max(3, Math.min(8, Math.min(innerW * 0.038, innerH * 0.1)));
  const arcStroke = arcStrokeOverride != null && arcStrokeOverride > 0
    ? Math.max(1, arcStrokeOverride)
    : autoStroke;
  const bottomPad = Math.max(1, arcStroke * 0.3);

  const cx = pad.left + innerW / 2;
  const cy = pad.top + innerH - bottomPad;
  const rx = Math.max(4, innerW / 2 - arcStroke * 0.5);
  const ry = Math.max(4, innerH - bottomPad - arcStroke * 0.5);

  const valueFs = Math.max(8, valueFsBase);
  const unitFs = Math.max(7, unitFsBase);

  const bowlCenterY = cy - (4 * ry) / (3 * Math.PI);
  const textStackH = valueFs * 0.9 + unitFs * 1.1;
  const textTop = bowlCenterY - textStackH * 0.48 + textGap;
  const valueY = textTop + valueFs * 0.45;
  const unitY = textTop + valueFs * 0.9 + unitFs * 0.55;

  const tickOut = Math.max(2.5, arcStroke * 0.75);
  const tickIn = Math.max(1.5, arcStroke * 0.35);

  return {
    w,
    h,
    cx,
    cy,
    rx,
    ry,
    arcStroke,
    valueFs,
    unitFs,
    valueY,
    unitY,
    tickIn,
    tickOut,
  };
}

export function resolveGaugeContentPaddingCss(p?: GaugeContentPadding): string {
  const pad = resolveGaugePadding(p);
  return `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
}
