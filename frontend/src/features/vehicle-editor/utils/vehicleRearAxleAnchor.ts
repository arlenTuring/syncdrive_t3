import type { VehicleDefinition } from '../types';
import {
  computeVehicleMapRenderBounds,
  mapDisplayContentSize,
} from './vehicleContentBounds';

/** 後軸距車尾端比例（沿車體長度 0→1，固定於樣板） */
const REAR_AXLE_FROM_TAIL_RATIO = 0.18;

/**
 * 後軸在車體上的固定比例（tail 端向內）。
 * 不隨 heading 翻轉：轉彎時只旋轉車體，後軸像素點必須固定，否則錨點會在頭尾之間跳動。
 */
function fixedRearAxleAlongBody(definition: VehicleDefinition): number {
  const body = definition.elements.find((el) => el.type === 'body');
  const tail = definition.elements.find(
    (el) => el.type === 'light' && el.visibilityField === 'tail_light_on',
  );
  if (body && tail) {
    const tailCenterX = tail.x + tail.width / 2;
    const along = (tailCenterX - body.x) / body.width - REAR_AXLE_FROM_TAIL_RATIO;
    return Math.max(0.05, Math.min(0.95, along));
  }
  return 1 - REAR_AXLE_FROM_TAIL_RATIO;
}

/** 後軸在載具內容座標（px，相對於 map render bounds 左上角，未縮放） */
export function computeVehicleRearAxleAnchorContentPx(
  definition: VehicleDefinition,
): { x: number; y: number } {
  const bounds = computeVehicleMapRenderBounds(definition);
  const content = mapDisplayContentSize(definition, bounds);
  const body = definition.elements.find((el) => el.type === 'body');
  const along = fixedRearAxleAlongBody(definition);

  if (body) {
    return {
      x: body.x + body.width * along - bounds.x,
      y: body.y + body.height / 2 - bounds.y,
    };
  }

  return {
    x: content.width * along,
    y: content.height / 2,
  };
}

/**
 * 後軸在載具顯示框內的錨點（px，相對於顯示框左上角）。
 */
export function computeVehicleRearAxleAnchorPx(
  definition: VehicleDefinition,
  displayWidth?: number,
  displayHeight?: number,
  fitMode: 'contain' | 'stretch' = 'contain',
): { x: number; y: number; contentX: number; contentY: number } {
  const bounds = computeVehicleMapRenderBounds(definition);
  const content = mapDisplayContentSize(definition, bounds);
  const { x: contentX, y: contentY } = computeVehicleRearAxleAnchorContentPx(definition);

  const targetW = displayWidth ?? content.width;
  const targetH = displayHeight ?? content.height;
  const scaleX = targetW / Math.max(1, content.width);
  const scaleY = targetH / Math.max(1, content.height);
  const uniformScale = Math.min(scaleX, scaleY);

  if (fitMode === 'stretch') {
    return {
      contentX,
      contentY,
      x: contentX * scaleX,
      y: contentY * scaleY,
    };
  }

  return {
    contentX,
    contentY,
    x: contentX * uniformScale,
    y: contentY * uniformScale,
  };
}

function computeVehicleBodyCenterContentPx(
  definition: VehicleDefinition,
): { x: number; y: number } {
  const bounds = computeVehicleMapRenderBounds(definition);
  const body = definition.elements.find((el) => el.type === 'body');
  if (body) {
    return {
      x: body.x + body.width / 2 - bounds.x,
      y: body.y + body.height / 2 - bounds.y,
    };
  }
  const content = mapDisplayContentSize(definition, bounds);
  return { x: content.width / 2, y: content.height / 2 };
}

/**
 * 後軸錨點 → 車身幾何中心，在顯示框內的位移（顯示框座標，y 向下）。
 * 與 VehicleDefinitionMapView rear-axle-pivot 的 rotate→scale 順序一致。
 */
export function computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx(
  definition: VehicleDefinition,
  displayWidth: number,
  displayHeight: number,
  fitMode: 'contain' | 'stretch',
  rotateDeg: number,
): { dx: number; dy: number } {
  const pivot = computeVehicleRearAxleAnchorPx(
    definition,
    displayWidth,
    displayHeight,
    fitMode,
  );
  const bounds = computeVehicleMapRenderBounds(definition);
  const display = mapDisplayContentSize(definition, bounds);
  const bodyCenter = computeVehicleBodyCenterContentPx(definition);

  const scaleX = displayWidth / Math.max(1, display.width);
  const scaleY = displayHeight / Math.max(1, display.height);
  const sx = fitMode === 'stretch' ? scaleX : Math.min(scaleX, scaleY);
  const sy = fitMode === 'stretch' ? scaleY : sx;

  const vx = bodyCenter.x - pivot.contentX;
  const vy = bodyCenter.y - pivot.contentY;
  const scaledVx = vx * sx;
  const scaledVy = vy * sy;
  /*
   * 與 CSS rotate() 同向。顯示框是 y 向下的座標，rotate(θ) 把 (x, y) 轉成
   * (x·cosθ − y·sinθ, x·sinθ + y·cosθ)。之前這裡的 sin 是反號，等於轉了 −θ：
   * θ=0 看不出來，θ=±90° 車身中心就被算到後軸的另一側，整台車往車頭方向平移約
   * 兩倍的後軸偏移量（T3 場區實測差 28 px，車長才 37 px），看起來就像停在格子上緣。
   */
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = scaledVx * cos - scaledVy * sin;
  const dy = scaledVx * sin + scaledVy * cos;
  return { dx, dy };
}

/**
 * 設施中心（Area 區域座標，y 向上）→ 應放置的後軸錨點座標。
 * 錨點仍在後軸，但位置反算使車身中心落在 targetCenter。
 */
export function computeRearAxleAreaLocalForBodyCenterAt(
  definition: VehicleDefinition,
  displayWidth: number,
  displayHeight: number,
  fitMode: 'contain' | 'stretch',
  rotateDeg: number,
  targetCenter: { x: number; y: number },
): { x: number; y: number } {
  const { dx, dy } = computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx(
    definition,
    displayWidth,
    displayHeight,
    fitMode,
    rotateDeg,
  );
  return {
    x: targetCenter.x - dx,
    y: targetCenter.y + dy,
  };
}

/** 圖示載具：後軸錨點 → 圖示幾何中心（顯示框內，y 向下） */
export function computeIconBodyCenterOffsetFromRearAxleInDisplayPx(
  markerWidth: number,
  markerHeight: number,
  anchorX: number,
  anchorY: number,
  rotateDeg: number,
): { dx: number; dy: number } {
  const vx = markerWidth * (0.5 - anchorX);
  const vy = markerHeight * (0.5 - anchorY);
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: vx * cos - vy * sin,
    dy: vx * sin + vy * cos,
  };
}

export function computeRearAxleAreaLocalForIconBodyCenterAt(
  markerWidth: number,
  markerHeight: number,
  anchorX: number,
  anchorY: number,
  rotateDeg: number,
  targetCenter: { x: number; y: number },
): { x: number; y: number } {
  const { dx, dy } = computeIconBodyCenterOffsetFromRearAxleInDisplayPx(
    markerWidth,
    markerHeight,
    anchorX,
    anchorY,
    rotateDeg,
  );
  return {
    x: targetCenter.x - dx,
    y: targetCenter.y + dy,
  };
}
