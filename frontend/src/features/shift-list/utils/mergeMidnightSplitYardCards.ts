/**
 * 午夜切開的整備卡合成一張
 * ========================
 *
 * 一天是循環的，午夜只是鐘面上的一個時刻。但時間模板上的整備條子畫到 24:00 為止，
 * 隔天再從 00:00 畫起，於是同一台車、同一個格位、同一種整備（例：待命 21:50–24:00
 * 接 待命 00:00–03:00）在班表上變成兩張卡——車根本沒動，卻多出一次假的交接
 * （S052150 → S050000）。
 *
 * 這裡把這種卡合成一張：開始是日尾那張的開始，結束記成 1440 以上（21:50 → 隔天 03:00），
 * 跟跨午夜的正線班次同一種表示法；畫面、訂單、佔用檢查本來就吃得下。
 *
 * 合併條件（全部成立才合）：
 * - 同一條時間線；兩張都是模板來的整備卡、同一種整備；
 * - 日尾那張剛好結束在日界，日頭那張剛好從日界開始；
 * - 同一個格位（都有定位，且沒有「無可用設施」）；
 * - 日界那一刻沒有夾別的卡（出廠、入廠、暫停）——有就代表車真的動過，不是同一段停留。
 *
 * 模板上原本是兩根條子，檢查「整備有沒有被刪、被壓過頭」時仍然要各算各的，
 * 所以合併後的卡帶著 {@link MidnightJoin}：記住日頭那張原本的 id 與切點。
 */
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline, MidnightJoin } from './schedule-engine/types';
import { SCHEDULE_DAY_MINUTES } from './scheduleDayCycle';

export type { MidnightJoin };

export type MidnightMergeRecord = {
  timelineRow: number;
  /** 合併後留下來的卡（日尾那張）的 id */
  blockId: string;
  /** 被併掉的卡（日頭那張）的 id */
  headBlockId: string;
};

const EPS = 1e-6;

const MERGEABLE_TASK_TYPES: ReadonlySet<string> = new Set([
  'standby',
  'charging',
  'servicing',
  'inspection',
  'washing',
]);

const isDayBoundary = (minute: number): boolean => {
  const mod = ((minute % SCHEDULE_DAY_MINUTES) + SCHEDULE_DAY_MINUTES) % SCHEDULE_DAY_MINUTES;
  return mod < EPS || SCHEDULE_DAY_MINUTES - mod < EPS;
};

/** 兩個分鐘在鐘面上是不是同一個時刻（差整數天） */
const sameClockMinute = (a: number, b: number): boolean => isDayBoundary(a - b);

function isMergeableYardCard(block: GeneratedScheduleBlock): boolean {
  return (
    block.source === 'template_bar'
    && MERGEABLE_TASK_TYPES.has(block.taskType)
    && block.plannedEndMinute - block.plannedStartMinute > EPS
    && block.midnightJoin == null
    && block.yardFacilityUnavailable !== true
    && typeof block.yardFacilityNodeId === 'string'
    && block.yardFacilityNodeId.length > 0
  );
}

/**
 * 就地把午夜切開的整備卡合成一張，回傳合了哪幾張。
 * 沒有符合條件的卡時不動任何東西。
 */
export function mergeMidnightSplitYardCards(
  timelines: GeneratedScheduleTimeline[],
): MidnightMergeRecord[] {
  const records: MidnightMergeRecord[] = [];
  for (const timeline of timelines) {
    const tail = timeline.blocks.filter(
      (block) => isMergeableYardCard(block) && block.plannedEndMinute > EPS && isDayBoundary(block.plannedEndMinute),
    );
    for (const tailBlock of tail) {
      const boundary = tailBlock.plannedEndMinute;
      const head = timeline.blocks.find(
        (block) =>
          block !== tailBlock
          && isMergeableYardCard(block)
          && isDayBoundary(block.plannedStartMinute)
          && sameClockMinute(block.plannedStartMinute, boundary)
          // 日頭那張要嘛記在當天開頭（0），要嘛已經記在日尾之後（1440）；不接更遠的
          && (Math.abs(block.plannedStartMinute - boundary) < EPS
            || Math.abs(block.plannedStartMinute - (boundary - SCHEDULE_DAY_MINUTES)) < EPS),
      );
      if (!head) continue;
      if (head.taskType !== tailBlock.taskType) continue;
      if (head.yardFacilityNodeId !== tailBlock.yardFacilityNodeId) continue;
      if ((head.yardFacilityStationId ?? null) !== (tailBlock.yardFacilityStationId ?? null)) continue;
      const tailMinutes = tailBlock.plannedEndMinute - tailBlock.plannedStartMinute;
      const headMinutes = head.plannedEndMinute - head.plannedStartMinute;
      // 合起來超過一天就不是「同一段停留被午夜切開」
      if (tailMinutes + headMinutes > SCHEDULE_DAY_MINUTES + EPS) continue;
      // 日界那一刻夾了別的卡（出入廠、暫停、0 秒轉場）：車動過，不合
      const somethingAtBoundary = timeline.blocks.some(
        (block) =>
          block !== tailBlock
          && block !== head
          && (
            (isDayBoundary(block.plannedStartMinute)
              && (Math.abs(block.plannedStartMinute - boundary) < EPS
                || Math.abs(block.plannedStartMinute - head.plannedStartMinute) < EPS))
            || (isDayBoundary(block.plannedEndMinute)
              && (Math.abs(block.plannedEndMinute - boundary) < EPS
                || Math.abs(block.plannedEndMinute - head.plannedStartMinute) < EPS))
          ),
      );
      if (somethingAtBoundary) continue;

      tailBlock.plannedEndMinute = boundary + headMinutes;
      tailBlock.midnightJoin = { headBlockId: head.id, splitMinute: boundary };
      if (tailBlock.requiredChargingSeconds != null || head.requiredChargingSeconds != null) {
        tailBlock.requiredChargingSeconds =
          (tailBlock.requiredChargingSeconds ?? Math.round(tailMinutes * 60))
          + (head.requiredChargingSeconds ?? Math.round(headMinutes * 60));
      }
      timeline.blocks.splice(timeline.blocks.indexOf(head), 1);
      records.push({ timelineRow: timeline.row, blockId: tailBlock.id, headBlockId: head.id });
    }
  }
  return records;
}

/**
 * 合併後的卡在「模板任務對照」時要拆回兩段來看：日尾那段算在自己的 id 上，
 * 日頭那段算在被併掉那張的 id 上。沒合併過的卡原樣回一段。
 */
export function splitMidnightJoinedSpans(
  block: Pick<GeneratedScheduleBlock, 'id' | 'plannedStartMinute' | 'plannedEndMinute' | 'midnightJoin'>,
): Array<{ id: string; startMinute: number; endMinute: number }> {
  const join = block.midnightJoin;
  if (!join) {
    return [{ id: block.id, startMinute: block.plannedStartMinute, endMinute: block.plannedEndMinute }];
  }
  const split = Math.min(Math.max(join.splitMinute, block.plannedStartMinute), block.plannedEndMinute);
  return [
    { id: block.id, startMinute: block.plannedStartMinute, endMinute: split },
    { id: join.headBlockId, startMinute: split, endMinute: block.plannedEndMinute },
  ];
}

/**
 * 合併之前就寫好的問題，可能還指著被併掉的那張卡。把指向改成合併後留下來的那張，
 * 否則畫面上點問題會找不到卡。
 */
export function remapMergedBlockIds(
  issues: ReadonlyArray<{ detail?: unknown }>,
  records: ReadonlyArray<MidnightMergeRecord>,
): void {
  if (records.length === 0) return;
  const target = new Map(records.map((record) => [record.headBlockId, record.blockId]));
  for (const issue of issues) {
    const detail = issue.detail;
    if (!detail || typeof detail !== 'object') continue;
    const bag = detail as Record<string, unknown>;
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value === 'string') {
        const mapped = target.get(value);
        if (mapped) bag[key] = mapped;
      } else if (Array.isArray(value) && value.some((item) => typeof item === 'string' && target.has(item))) {
        bag[key] = value.map((item) => (typeof item === 'string' ? target.get(item) ?? item : item));
      }
    }
  }
}
