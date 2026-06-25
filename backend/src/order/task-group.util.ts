export type TaskGroupRow = {
  task_name?: string;
  status?: string;
};

/** 依 task_group 推導儀表板作動圖示代碼（進站 enter / 出站 exit） */
export function deriveOperationActionFromTaskGroup(
  taskGroup: unknown,
): 'enter' | 'exit' | null {
  if (!Array.isArray(taskGroup)) return null;
  const active = (taskGroup as TaskGroupRow[]).filter(
    (t) => String(t?.status ?? '').toUpperCase() === 'IN_PROGRESS',
  );
  if (active.some((t) => t.task_name === 'STATION_DEPARTURE')) return 'exit';
  if (active.some((t) => t.task_name === 'PLATFORM_DOCKING')) return 'enter';
  return null;
}

export function buildProtocolTaskId(
  orderId: string,
  taskName: string,
  sequence: number,
): string {
  return `${orderId}_${taskName}_${String(sequence).padStart(2, '0')}`;
}
