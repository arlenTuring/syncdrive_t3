import type { CanvasElementProps, ChildWidget } from '../types';

export type GroupTileFit = 'fixed' | 'fill' | 'slot';

export function resolveGroupTilePad(element: Pick<CanvasElementProps, 'groupTilePadding' | 'groupTilePadX' | 'groupTilePadY'>): {
  padX: number;
  padY: number;
} {
  const all = element.groupTilePadding ?? 4;
  return {
    padX: element.groupTilePadX ?? all,
    padY: element.groupTilePadY ?? all,
  };
}

export interface GroupTileLayout {
  fit: GroupTileFit;
  tileWidth: number;
  tileHeight: number;
  padX: number;
  padY: number;
  gapX: number;
  gapY: number;
  /** 屬性面板設定的最大欄數 */
  gridCols: number;
  /** 實際用於排版／算寬的欄數 */
  layoutCols: number;
  gridRows: number;
}

/**
 * 依「11 格」等固定欄數計算單槽寬高（與資料筆數無關）。
 * 供範例版面與屬性面板同步子畫布邊界。
 */
export function computeGroupSlotTemplateSize(
  element: Pick<
    CanvasElementProps,
    'width' | 'height' | 'gridColumns' | 'gapX' | 'groupTilePadding' | 'groupTilePadX' | 'groupTilePadY' | 'slotCount' | 'groupRepeatMode'
  >,
  opts?: { slotCols?: number },
): { width: number; height: number; slotCols: number } {
  const slotCols = Math.max(
    1,
    opts?.slotCols ??
      (element.groupRepeatMode === 'slots'
        ? (element.slotCount ?? element.gridColumns ?? 1)
        : (element.gridColumns ?? 11)),
  );
  const gapX = element.gapX ?? 12;
  const { padX, padY } = resolveGroupTilePad(element);
  const canvasW = Math.max(1, element.width ?? 300);
  const canvasH = Math.max(1, element.height ?? 180);
  const innerW = canvasW - padX * 2;
  const innerH = canvasH - padY * 2;
  const width = Math.max(1, Math.floor((innerW - (slotCols - 1) * gapX) / slotCols));
  const height = Math.max(1, innerH);
  return { width, height, slotCols };
}

/**
 * 依畫布尺寸、欄數、資料筆數計算子範本實際寬高。
 * - slot：槽寬依 gridColumns，只渲染資料筆數、靠左
 * - fill：子範本撐滿（欄數 = min(gridColumns, 筆數)）
 * - fixed：使用 templateWidth × templateHeight
 */
export function computeGroupTileLayout(
  element: CanvasElementProps,
  itemCount: number,
  opts?: { gridColumns?: number },
): GroupTileLayout {
  const layoutMode = element.layoutMode || 'grid';
  const gridCols = Math.max(1, opts?.gridColumns ?? element.gridColumns ?? 1);
  const gapX = element.gapX ?? 12;
  const gapY = element.gapY ?? 12;
  const { padX, padY } = resolveGroupTilePad(element);
  const designW = Math.max(1, element.templateWidth || 300);
  const designH = Math.max(1, element.templateHeight || 180);
  const canvasW = Math.max(1, element.width ?? designW * gridCols);
  const canvasH = Math.max(1, element.height ?? designH);
  const count = Math.max(1, itemCount);
  const fit: GroupTileFit = element.groupTileFit ?? 'fill';
  const slotMode =
    fit === 'slot' &&
    (layoutMode === 'grid' || element.groupRepeatMode === 'slots' || element.groupRepeatMode === 'tile');

  if (slotMode) {
    const slotCols = Math.max(
      1,
      opts?.gridColumns ??
        (element.groupRepeatMode === 'slots'
          ? (element.slotCount ?? element.gridColumns ?? 1)
          : (element.gridColumns ?? 11)),
    );
    const { width: tileWidth, height: tileHeight } = computeGroupSlotTemplateSize(element, {
      slotCols,
    });
    const layoutCols = slotCols;
    const gridRows = Math.ceil(count / layoutCols);
    return {
      fit: 'slot',
      tileWidth,
      tileHeight,
      padX,
      padY,
      gapX,
      gapY,
      gridCols,
      layoutCols,
      gridRows,
    };
  }

  const layoutCols =
    layoutMode === 'grid' && fit === 'fill'
      ? Math.min(gridCols, count)
      : gridCols;

  const gridRows = layoutMode === 'grid' ? Math.ceil(count / layoutCols) : 1;

  if (layoutMode !== 'grid' || fit === 'fixed') {
    const usedCols = layoutMode === 'grid' ? Math.min(count, layoutCols) : 1;
    const tilesW = usedCols * designW + Math.max(0, usedCols - 1) * gapX;
    const tilesH = gridRows * designH + Math.max(0, gridRows - 1) * gapY;
    const padXResolved =
      element.groupTileAlign === 'center'
        ? Math.max(padX, (canvasW - tilesW) / 2)
        : padX;
    const padYResolved = Math.max(padY, (canvasH - tilesH) / 2);
    return {
      fit: 'fixed',
      tileWidth: designW,
      tileHeight: designH,
      padX: padXResolved,
      padY: padYResolved,
      gapX,
      gapY,
      gridCols,
      layoutCols: usedCols,
      gridRows,
    };
  }

  const innerW = canvasW - padX * 2;
  const innerH = canvasH - padY * 2;
  const tileWidth = Math.floor((innerW - (layoutCols - 1) * gapX) / layoutCols);
  const tileHeight = Math.floor((innerH - (gridRows - 1) * gapY) / gridRows);

  return {
    fit: 'fill',
    tileWidth: Math.max(1, tileWidth),
    tileHeight: Math.max(1, tileHeight),
    padX,
    padY,
    gapX,
    gapY,
    gridCols,
    layoutCols,
    gridRows,
  };
}

/** 子元件實際佔用的設計稿高度（y + height 最大值） */
export function getTemplateContentExtent(children: ChildWidget[]): { w: number; h: number } {
  let w = 1;
  let h = 1;
  for (const c of children) {
    w = Math.max(w, c.x + c.width);
    h = Math.max(h, c.y + c.height);
  }
  return { w, h };
}

/** 設計稿範本尺寸（templateWidth × templateHeight） */
export function getTemplateDesignSize(element: CanvasElementProps): { designW: number; designH: number } {
  const storedW = Math.max(1, element.templateWidth || 300);
  const storedH = Math.max(1, element.templateHeight || 180);
  if (!element.children?.length) {
    return { designW: storedW, designH: storedH };
  }
  const extent = getTemplateContentExtent(element.children);
  return {
    designW: Math.max(storedW, extent.w),
    designH: Math.max(storedH, extent.h),
  };
}

export type GroupTileScaleMode = 'contain' | 'cover';

export interface TemplateScale {
  /** fill 模式等比例縮放 */
  scale: number;
  /** slot 模式：非等比拉伸填滿槽位 */
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  designW: number;
  designH: number;
}

/**
 * fill：cover／contain 等比縮放；
 * slot：依 template 設計尺寸非等比拉伸至槽位（群組改大小仍貼滿）；
 * fixed：不縮放。
 */
export function getTemplateUniformScale(
  element: CanvasElementProps,
  actualWidth: number,
  actualHeight: number,
): TemplateScale {
  const fit: GroupTileFit = element.groupTileFit ?? 'fill';
  const storedW = Math.max(1, element.templateWidth || 300);
  const storedH = Math.max(1, element.templateHeight || 180);
  const extent = element.children?.length
    ? getTemplateContentExtent(element.children)
    : { w: storedW, h: storedH };
  /** slot 模式：以子元件實際高度縮放，貼滿槽位（避免 templateHeight 大於內容留底縫） */
  const designW = storedW;
  const designH = fit === 'slot' ? Math.max(1, extent.h) : Math.max(storedH, extent.h);
  if (fit === 'fixed') {
    return { scale: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, designW: storedW, designH: storedH };
  }
  if (fit === 'slot') {
    const scaleX = actualWidth / designW;
    const scaleY = actualHeight / designH;
    return { scale: 1, scaleX, scaleY, offsetX: 0, offsetY: 0, designW, designH };
  }
  const sx = actualWidth / designW;
  const sy = actualHeight / designH;
  const scaleMode: GroupTileScaleMode = element.groupTileScaleMode ?? 'contain';
  const scale = scaleMode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return {
    scale,
    scaleX: scale,
    scaleY: scale,
    offsetX: (actualWidth - designW * scale) / 2,
    offsetY: (actualHeight - designH * scale) / 2,
    designW,
    designH,
  };
}
