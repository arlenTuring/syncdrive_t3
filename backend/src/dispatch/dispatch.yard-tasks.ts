'use strict';

/**
 * 從班表計畫裡抽出<strong>整備班次</strong>（充電、行檢、保養、洗車、臨停、待命）。
 *
 * <h3>整備也是班次，不是「停著就不用管」</h3>
 * 車輛停在格位上不代表系統不需要知道。整備格位的佔用狀況、車輛卡片右上角的
 * 徽章、班次運行紀錄的「整備班次」分頁，全部是從
 * <code>line_kind = 'MAINTENANCE'</code> 的訂單長出來的。不發整備訂單的結果是：
 * 整備分佈永遠 0/16、整備班次分頁永遠空的、車輛卡片認不出這台車正在充電。
 *
 * <h3>任務種類看格位代號</h3>
 * 格位代號的首字母就是任務種類，這是既有的約定（見
 * <code>scripts/maintenance-task-catalog.js</code>）：
 *
 * <pre>
 *   E → 充電    P → 臨停    W → 洗車    H → 調度    M → 保養
 * </pre>
 *
 * 用格位而不是卡片標籤來判定，是因為<strong>格位是實體、標籤是說法</strong>：
 * 同一格 E3 不管卡片寫「充電」還是「待命」，車都是停在充電格上，整備分佈那一格
 * 就該亮著。
 */

/** 格位代號首字母 → 任務顯示樣式。與 maintenance-task-catalog.js 同一份約定。 */
const SLOT_PREFIX_TASK: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  E: { label: '充電', bg: '#422006', color: '#FD9A00' },
  P: { label: '臨停', bg: '#27272a', color: '#FD9A00' },
  W: { label: '洗車', bg: '#422006', color: '#FD9A00' },
  H: { label: '調度', bg: '#422006', color: '#FD9A00' },
  M: { label: '保養', bg: '#422006', color: '#FD9A00' },
};

/** 會產生整備訂單的任務類型。載客與空車移動各有自己的路徑。 */
const YARD_TASK_TYPES = new Set([
  'charging',
  'inspection',
  'servicing',
  'standby',
  'idle',
]);

export type YardTask = {
  blockId: string;
  timelineRow: number;
  /** 供 order_id 使用的短碼，同一份班表內穩定 */
  tripCode: string;
  /** 卡片上的說法（充電、行檢、待命、暫停放…） */
  cardLabel: string;
  /** 徽章文字，由格位代號決定 */
  maintTypeLabel: string;
  maintTypeBg: string;
  maintTypeColor: string;
  /** 格位代號（E3、H1、M3…），整備分佈靠這個知道哪一格被佔著 */
  yardSlotId: string;
  /** 場區設施節點 id */
  facilityNodeId: string;
  startMinute: number;
  endMinute: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 格位代號 → 徽章。認不出首字母時退回「整備」，不要讓卡片空著。 */
export function maintenanceMetaForSlot(yardSlotId: string): {
  label: string;
  bg: string;
  color: string;
} {
  const prefix = yardSlotId.replace(/[0-9].*$/, '').toUpperCase();
  return (
    SLOT_PREFIX_TASK[prefix] ?? {
      label: '整備',
      bg: '#422006',
      color: '#FD9A00',
    }
  );
}

/**
 * 短碼：格位 ＋ 時間線列 ＋ 起始秒。
 *
 * 與空車移動同一套理由：block id 帶著產生時的時戳，重算一次班表就整批換號；
 * 列、格位與分鐘是計畫本身的內容，重算幾次都一樣。
 */
function buildTripCode(
  slotId: string,
  row: number,
  startMinute: number,
): string {
  return `MT-${slotId.toUpperCase()}-R${row}-${Math.round(startMinute * 60)}`;
}

/**
 * 抽出計畫中的全部整備班次。
 *
 * 只認<strong>有場區設施節點</strong>的卡。正線上的暫停卡（車停在月台等下一班）
 * 也是 taskType='idle'，但它記的是站點不是格位——那不是整備，不該佔用整備格位。
 */
export function extractYardTasks(body: Record<string, unknown>): {
  tasks: YardTask[];
  skipped: Array<{ blockId: string; reason: string }>;
} {
  const plan = asRecord(asRecord(body.scheduleOutput)?.plan);
  const timelines = plan?.timelines;
  const tasks: YardTask[] = [];
  const skipped: Array<{ blockId: string; reason: string }> = [];
  if (!Array.isArray(timelines)) return { tasks, skipped };

  const configuredLabels = asRecord(body.maintenanceSectionCardLabelBySection);
  const labelKeyByTaskType: Record<string, string> = {
    charging: 'charging',
    inspection: 'preTrip',
    servicing: 'maintenance',
    standby: 'mobile',
  };

  for (const timeline of timelines) {
    const tl = asRecord(timeline);
    if (!tl || !Array.isArray(tl.blocks)) continue;

    for (const item of tl.blocks) {
      const block = asRecord(item);
      if (!block) continue;
      const taskType = str(block.taskType);
      if (!taskType || !YARD_TASK_TYPES.has(taskType)) continue;

      const blockId = str(block.id) ?? '(無 id)';
      const facilityNodeId = str(block.yardFacilityNodeId);
      const yardSlotId = str(block.yardFacilityLabel);
      // 正線月台上的暫停卡沒有格位，跳過且不算異常——它本來就不是整備
      if (!facilityNodeId || !yardSlotId) continue;
      // 待命卡也可能停在<strong>備用月台</strong>而不是場區格位：那種卡帶著
      // yardFacilityStationId，標籤是站名（「[備用]N2W下行出發」）。車停在月台上
      // 沒有佔用任何整備格位，發成整備訂單會讓整備分佈多出不存在的佔用。
      if (str(block.yardFacilityStationId)) continue;
      if (!/^[A-Za-z]+[0-9]+$/.test(yardSlotId)) {
        skipped.push({
          blockId,
          reason: `格位代號「${yardSlotId}」不像場區格位，未發整備訂單`,
        });
        continue;
      }

      const startMinute = num(block.plannedStartMinute);
      const endMinute = num(block.plannedEndMinute);
      if (startMinute == null || endMinute == null) {
        skipped.push({ blockId, reason: '整備卡缺少計畫起訖時刻' });
        continue;
      }

      const row = num(block.timelineRow) ?? 1;
      const meta = maintenanceMetaForSlot(yardSlotId);
      const labelKey = labelKeyByTaskType[taskType];
      const configuredLabel = labelKey ? str(configuredLabels?.[labelKey]) : null;

      tasks.push({
        blockId,
        timelineRow: row,
        tripCode: buildTripCode(yardSlotId, row, startMinute),
        cardLabel: str(block.source) === 'hold'
          ? '暫停'
          : configuredLabel ?? str(block.label) ?? meta.label,
        maintTypeLabel: meta.label,
        maintTypeBg: meta.bg,
        maintTypeColor: meta.color,
        yardSlotId: yardSlotId.toUpperCase(),
        facilityNodeId,
        startMinute,
        endMinute,
      });
    }
  }

  return { tasks, skipped };
}
