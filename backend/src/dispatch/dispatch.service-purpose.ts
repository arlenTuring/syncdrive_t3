/**
 * 班表時間線上每張卡「服務的是什麼」：營運、整備或待命。
 * ================================================
 *
 * 營運分佈（營運中／整備中／待命中）要按任務的用途分，不能看車速、狀態、停在哪一格或卡片文字。
 * 用途在排班展開時就知道——同一列時間線上前後是哪些卡——所以在這裡算一次，下單時存進訂單
 * （payload.service_purpose），之後查詢不必靠下一張單去猜。
 *
 * <table>
 *   <tr><td>載客（passenger）</td><td>營運</td></tr>
 *   <tr><td>充電、行檢、保養、洗車</td><td>整備</td></tr>
 *   <tr><td>待命（standby）</td><td>待命：車在候用，沒有承接營運或整備</td></tr>
 *   <tr><td>出廠、入廠、調度移動、暫停（idle）</td><td>服務緊接在後的那張卡（往後找第一張上面三類的卡）</td></tr>
 * </table>
 *
 * 暫停是接到下一張任務之前的必要等待（實測場區暫停 1～13 分鐘）；長時間停放在排班裡是另一種卡
 * （待命），所以不會出現「幾小時後才出發的車整段算營運中」。後面沒有任何任務時算待命。
 */

export type ServicePurpose = 'operation' | 'maintenance' | 'standby';

const ANCHOR_PURPOSE: Record<string, ServicePurpose> = {
  passenger: 'operation',
  charging: 'maintenance',
  inspection: 'maintenance',
  servicing: 'maintenance',
  washing: 'maintenance',
  standby: 'standby',
};

export type BlockPurpose = {
  purpose: ServicePurpose;
  /** 服務的那張卡的任務類型（passenger、charging…）；本身就是錨點時是自己 */
  servesTaskType: string | null;
  servesBlockId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 班表內容 → 每張卡（blockId）服務的用途 */
export function servicePurposeByBlock(body: Record<string, unknown>): Map<string, BlockPurpose> {
  const result = new Map<string, BlockPurpose>();
  const timelines = asRecord(asRecord(body.scheduleOutput)?.plan)?.timelines;
  if (!Array.isArray(timelines)) return result;
  for (const timeline of timelines) {
    const blocks = asRecord(timeline)?.blocks;
    if (!Array.isArray(blocks)) continue;
    const ordered = blocks
      .map((raw) => asRecord(raw))
      .filter((block): block is Record<string, unknown> => block != null && typeof block.id === 'string')
      .map((block) => ({
        id: block.id as string,
        taskType: typeof block.taskType === 'string' ? block.taskType : '',
        start: num(block.plannedStartMinute) ?? Number.POSITIVE_INFINITY,
        end: num(block.plannedEndMinute) ?? Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    // 從後往前掃：記住「後面最近的一張錨點卡」
    let next: { purpose: ServicePurpose; taskType: string; id: string } | null = null;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const block = ordered[i];
      const own = ANCHOR_PURPOSE[block.taskType];
      if (own) {
        result.set(block.id, { purpose: own, servesTaskType: block.taskType, servesBlockId: block.id });
        next = { purpose: own, taskType: block.taskType, id: block.id };
      } else {
        result.set(block.id, next
          ? { purpose: next.purpose, servesTaskType: next.taskType, servesBlockId: next.id }
          : { purpose: 'standby', servesTaskType: null, servesBlockId: null });
      }
    }
  }
  return result;
}
