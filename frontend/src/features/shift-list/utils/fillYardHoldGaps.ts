import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type {
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';

/**
 * 補上「暫停」卡：整備做完、車還在格子裡的那段
 * ============================================
 *
 * <strong>暫停不是待命。</strong>待命是<strong>指令</strong>——為了下一趟要去的地方，
 * 先開到那裡等；暫停是<strong>沒有指令</strong>——整備卡在卡內把事情做完了，剩下的
 * 空隙車就停在那裡，但時間軸上沒有任何東西記載這件事。
 *
 * <strong>為什麼要補成一張卡，而不是讓偵測器自己推論。</strong>站位那邊是用
 * <code>actualDepartMinute</code> 把佔用延長到車真正開走，所以站位碰撞抓得到「賴站
 * 擋人」。但那是<strong>某一個偵測器內部的推論</strong>——沒有複製那段推論的地方就
 * 有同樣的盲點。設施佔用就是活生生的例子：它只記
 * <code>[整備開始, 整備結束]</code>，於是「整備做完、還沒開走」的那段帳上是空的：
 *
 * <pre>
 *   列4  充電 @ E3   22:12:40 – 00:00:00   ← 登記的佔用只到這裡
 *   列4  整備出廠 E3 → N2W下行出發  00:01:00 – 00:01:30   ← 車 00:01:00 才開走
 *   列7  整備入廠 → E3              00:00:30 – 00:01:00   ← 朝著「帳面上空」的格子開過去
 *   列7  充電 @ E3                  00:01:00 – 01:30:00   ← 零間隔交接
 * </pre>
 *
 * 使用者（2026-08-24）：「當你的機制有辦法補滿所有的時間空隙的時候，就能真正的去
 * 看待任何的碰撞跟移動……這不是一種裝飾，而是你架構上再做最後驗證以及修正所需要
 * 考慮到自己可能會產生演算法缺陷的問題。」
 *
 * <strong>兩側都要補。</strong>先前只補設施側，理由是「站位側已經由
 * <code>actualDepartMinute</code> 涵蓋」——那個理由是錯的。查證（2026-08-25）之後
 * 那段推論有三個但書：只在末站、只在碰撞保護開著時、而且只算超過
 * {@link MEANINGFUL_IDLE_GAP_SECONDS}（60 秒）的空隙。60 秒以下的滯留全系統看不見，
 * 而碰撞保護是 30 秒——一段 50 秒的滯留是真的衝突窗口，卻沒有任何人記得。
 * 更根本的是那是<strong>某一個偵測器函式內部的推論</strong>，不是資料：評分、設施
 * 佔用、之後任何要看轉折點或路徑佔用的偵測，全都看不到同一批秒數。
 *
 * 補完之後時間軸<strong>零未覆蓋空隙</strong>（263.76 小時全被卡覆蓋），其中正線側
 * 291 段、設施側 34 段，新看得見的是 36 段 60 秒以下的滯留。
 *
 * <strong>補卡不能改變任何人的決策。</strong>插卡會改變「前一張／下一張」，實測踩到
 * 兩處，兩處都是「把暫停卡誤認成下一個任務」：
 *
 * <ol>
 *   <li>{@link resolveSameRowNextBlockStartMinute} 掃到暫停卡，空隙變 0，滯留推論
 *       失效——站位碰撞從 0 對變 1 對。解法是讓暫停卡對那個掃描透明。</li>
 *   <li><code>yieldIdleBlockArrival</code> 要把卡往後挪，後面貼著暫停卡就挪不動，
 *       讓渡從 11 次掉到 10 次。解法是補卡排到它後面——補卡必須在<strong>所有會動
 *       時刻的處理跑完之後</strong>。</li>
 * </ol>
 *
 * 兩處修完之後與補卡前完全一致（同樣 11 次讓渡、0 對碰撞、班次與承接率不變）。
 *
 * <strong>掛 <code>idle</code> 而不是 <code>standby</code>。</strong>整備轉場機制以
 * <code>taskType === 'standby'</code> 認定「這是排定的待命，要幫它排進出廠卡」；掛成
 * standby 會被重複服務（2026-08-18 實測：MAINTENANCE_TRANSFER_UNRESOLVED 13 → 22，
 * 且冒出前面根本沒有整備的孤兒出場卡）。
 */

/** 車真的停在裡面的那幾種整備 */
const YARD_TASK_TYPES = new Set([
  'charging',
  'servicing',
  'inspection',
  'standby',
  'washing',
]);

function isZeroLength(block: GeneratedScheduleBlock): boolean {
  return block.plannedEndMinute - block.plannedStartMinute <= 1e-9;
}

/**
 * 這一趟載客跑完之後，車停在哪一站。
 *
 * 末站就是它停的地方——中間站是開過去的，不會停在那裡等。拿不到路線或站序時
 * 回 null，那種情況寧可不補卡：補一張標錯地點的卡比沒有卡更糟，偵測器會拿它
 * 去跟別台車比對。
 */
function resolveParkedStation(
  block: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[] | null | undefined,
): { stationId: string; stationName: string } | null {
  if (block.taskType !== 'passenger') return null;
  const route = resolveRouteForBlock(block, selectedRoutes);
  if (!route) return null;
  const stops = buildBlockStationDepartures(block, route);
  const last = stops[stops.length - 1];
  const stationId = last?.stationId?.trim();
  if (!stationId) return null;
  return { stationId, stationName: last!.stationName || stationId };
}

export function fillYardHoldGaps(args: {
  timelines: GeneratedScheduleTimeline[];
  /**
   * 有給就連正線側的空隙一起補——車跑完一趟停在末站等下一趟的那段。
   *
   * 需要路線才知道末站是哪一站，所以是選配：拿不到路線的呼叫端（測試、
   * 只想補設施側的舊路徑）照舊只補設施側。
   */
  selectedRoutes?: ShiftScheduleSelectedRoute[] | null;
}): {
  timelines: GeneratedScheduleTimeline[];
  inserted: number;
  heldSeconds: number;
  stationInserted: number;
  stationHeldSeconds: number;
} {
  const { timelines, selectedRoutes } = args;
  let inserted = 0;
  let heldSeconds = 0;
  let stationInserted = 0;
  let stationHeldSeconds = 0;

  for (const timeline of timelines) {
    // 零長度卡（同區域 0 秒轉場的示意卡）不佔時間，夾在中間會讓「前一張」認錯人
    const ordered = [...timeline.blocks]
      .filter((block) => !isZeroLength(block))
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    const added: GeneratedScheduleBlock[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const next = ordered[index]!;

      const gapMinutes = next.plannedStartMinute - previous.plannedEndMinute;
      if (gapMinutes <= 1 / 60) continue;

      const facilityNodeId = YARD_TASK_TYPES.has(previous.taskType)
        ? previous.yardFacilityNodeId?.trim()
        : undefined;

      // 正線側：跑完一趟停在末站等下一趟。地點是停靠站，不是設施格
      if (!facilityNodeId) {
        const parked = selectedRoutes ? resolveParkedStation(previous, selectedRoutes) : null;
        if (!parked) continue;
        added.push({
          id: `hold-${previous.id}-${Math.round(previous.plannedEndMinute * 60)}`,
          timelineRow: timeline.row,
          taskType: 'idle',
          label: `列車 ${timeline.row} · 暫停`,
          anchorStartMinute: previous.plannedEndMinute,
          plannedStartMinute: previous.plannedEndMinute,
          plannedEndMinute: next.plannedStartMinute,
          travelSeconds: 0,
          dwellSeconds: Math.round(gapMinutes * 60),
          source: 'hold',
          // 停靠站不是設施格：不給 yardFacilityNodeId，設施佔用驗證才不會誤收
          yardFacilityLabel: parked.stationName,
          yardFacilityStationId: parked.stationId,
        } as GeneratedScheduleBlock);
        stationInserted += 1;
        stationHeldSeconds += gapMinutes * 60;
        continue;
      }

      const facilityLabel = previous.yardFacilityLabel ?? facilityNodeId;
      added.push({
        id: `hold-${previous.id}-${Math.round(previous.plannedEndMinute * 60)}`,
        timelineRow: timeline.row,
        taskType: 'idle',
        // 卡面渲染會自己補上「· 設施」，這裡再寫一次會變成「M2 · M2」
        label: `列車 ${timeline.row} · 暫停`,
        anchorStartMinute: previous.plannedEndMinute,
        plannedStartMinute: previous.plannedEndMinute,
        plannedEndMinute: next.plannedStartMinute,
        travelSeconds: 0,
        dwellSeconds: Math.round(gapMinutes * 60),
        source: 'hold',
        // 車就停在這一格——設施佔用要看得到它
        yardFacilityNodeId: facilityNodeId,
        yardFacilityLabel: facilityLabel,
        yardFacilityStationId: previous.yardFacilityStationId,
      } as GeneratedScheduleBlock);
      inserted += 1;
      heldSeconds += gapMinutes * 60;
    }

    if (added.length > 0) {
      timeline.blocks.push(...added);
      timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    }
  }

  return { timelines, inserted, heldSeconds, stationInserted, stationHeldSeconds };
}
