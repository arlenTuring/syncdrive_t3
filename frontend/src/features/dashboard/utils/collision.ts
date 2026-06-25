/** AABB 矩形重疊判斷（邊緣接觸不算重疊） */
export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** 是否超出容器邊界 */
export function isOutOfBounds(
  x: number, y: number, w: number, h: number,
  cw: number, ch: number,
): boolean {
  return x < 0 || y < 0 || x + w > cw || y + h > ch;
}

/** 已停用：允許畫布重疊 */
export function checkCanvasCollision(
  _others: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  _movingId: string,
  _newX: number, _newY: number,
  _w: number, _h: number,
  _planeW: number, _planeH: number,
): boolean {
  return false;
}

/** color-block 僅作背景，不與其他元件計算重疊 */
export function isDecorativeWidgetType(type: string): boolean {
  return type === 'color-block';
}

export function getWidgetCollisionPeers<T extends { id: string; type: string; x: number; y: number; width: number; height: number }>(
  children: T[],
  movingId: string,
  movingType: string,
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  return children
    .filter(c => {
      if (c.id === movingId) return false;
      if (isDecorativeWidgetType(movingType)) return false;
      if (isDecorativeWidgetType(c.type)) return false;
      return true;
    })
    .map(c => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height }));
}

/** 已停用：允許子元件重疊 */
export function checkWidgetCollision(
  _others: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  _movingId: string,
  _newX: number, _newY: number,
  _w: number, _h: number,
  _canvasW: number, _canvasH: number,
): boolean {
  return false;
}

export type LayoutIssueReason =
  | 'out_of_bounds'
  | 'widget_overlap'
  | 'canvas_overlap'
  | 'canvas_out_of_bounds';

export interface LayoutIssue {
  refId: string;
  refLabel: string;
  kind: 'canvas' | 'widget';
  canvasId?: string;
  reasons: LayoutIssueReason[];
  detail: string;
  peerId?: string;
  peerLabel?: string;
}

export function collectLayoutIssues(
  _plane: { width: number; height: number; elements: any[] },
  _opts?: { templateMode?: boolean },
): LayoutIssue[] {
  return [];
}

export function layoutIssuesByRefId(issues: LayoutIssue[]): Map<string, LayoutIssue> {
  const map = new Map<string, LayoutIssue>();
  for (const issue of issues) {
    const prev = map.get(issue.refId);
    if (!prev) {
      map.set(issue.refId, issue);
      continue;
    }
    map.set(issue.refId, {
      ...prev,
      reasons: [...new Set([...prev.reasons, ...issue.reasons])],
      detail: `${prev.detail}；${issue.detail}`,
    });
  }
  return map;
}

export function collectGroupTemplateIssues(group: {
  templateWidth?: number;
  templateHeight?: number;
  children: any[];
  label?: string;
}): LayoutIssue[] {
  return collectLayoutIssues(
    {
      width: Math.max(1, group.templateWidth ?? 300),
      height: Math.max(1, group.templateHeight ?? 200),
      elements: [{
        id: 'template-root',
        label: group.label ?? '範本',
        x: 0, y: 0,
        width: Math.max(1, group.templateWidth ?? 300),
        height: Math.max(1, group.templateHeight ?? 200),
        children: group.children,
      }],
    },
    { templateMode: true },
  );
}

export function validateGroupTemplate(
  _group: {
    templateWidth?: number;
    templateHeight?: number;
    children: any[];
    label?: string;
  },
): { valid: boolean; error?: string; issues: LayoutIssue[] } {
  return { valid: true, issues: [] };
}

export function validatePlane(_plane: { width: number; height: number; elements: any[] }): { valid: boolean; error?: string; issues: LayoutIssue[] } {
  return { valid: true, issues: [] };
}
