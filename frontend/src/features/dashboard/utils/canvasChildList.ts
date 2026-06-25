export const CANVAS_CHILD_LIST_CLOSE_EVENT = 'syncdrive-close-canvas-child-list';

export function notifyCloseCanvasChildList(canvasId: string): void {
  window.dispatchEvent(
    new CustomEvent(CANVAS_CHILD_LIST_CLOSE_EVENT, { detail: { canvasId } }),
  );
}
