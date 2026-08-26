/**
 * 從班表計畫裡抽出<strong>空車移動</strong>卡（整備出廠、整備入廠、讓站移動／返回）。
 *
 * <h3>為什麼不走 expandTimetableTrips</h3>
 * 那一支處理的是載客班次：A/B 點來自 <code>stationDwells</code> 的站序。空車移動卡
 * 沒有站序——它的兩端是<strong>場區設施節點</strong>與<strong>站點</strong>，存在
 * <code>yardExit*</code> 那組欄位裡。硬塞進同一支展開函式會讓對外的班次介面多出
 * 場區設施結構，那是我方的場站配置，不該出現在廠商看得到的介面上。
 *
 * <h3>同一組欄位，兩個方向</h3>
 * 出廠與入廠的欄位名<strong>完全相同</strong>（都叫 <code>yardExit*</code>），方向
 * 靠 <code>source</code> 分辨：
 *
 * <pre>
 *   yard_exit_move （出廠、讓站返回）  設施 ──▶ 站點
 *   yard_entry_move（入廠、讓站移動）  站點 ──▶ 設施
 * </pre>
 *
 * 讀錯方向的後果不是報錯，是<strong>車開反方向</strong>——所以這個判斷不能省略，
 * 也不能靠 label 文字去猜。
 *
 * <h3>有一種卡只記了一端</h3>
 * 「讓站移動」用的是另一組欄位名（<code>yardEntryFacility*</code>），而且<strong>只
 * 有設施端</strong>——車從哪來沒記，因為那就是它上一張卡的終點。這種卡的另一端留
 * null，由排程層照相鄰卡補齊。
 */

/** 空車移動的一端 */
export type YardMoveEndpoint = {
  /** 站點時是 station id；設施時是圖資節點 id */
  id: string;
  name: string;
  kind: 'station' | 'facility';
};

export type YardMove = {
  blockId: string;
  timelineRow: number;
  /** 供 order_id 使用的短碼，同一份班表內穩定 */
  tripCode: string;
  label: string;
  /** 場區作業分類代碼（E 充電、P 行檢、H 停放…），沒有時為 null */
  sectionCode: string | null;
  startMinute: number;
  endMinute: number;
  /**
   * 起點。<strong>可能是 null</strong>——「讓站移動」卡只記了要去的設施，沒記從哪來，
   * 因為它的起點就是車輛<strong>上一張卡的終點</strong>。補齊的工作在排程層做
   * （那裡才同時看得到正線班次與移動卡）。
   */
  origin: YardMoveEndpoint | null;
  /** 終點。同樣可能是 null，理由相同。 */
  destination: YardMoveEndpoint | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 短碼：方向 ＋ 時間線列 ＋ 起始分鐘。
 *
 * 用「列＋分鐘」而不是 block id：block id 帶著產生時的時戳，同一份班表重新產生就
 * 全部換過，訂單編號會跟著全變。列與分鐘則是<strong>計畫本身的內容</strong>——同一
 * 班移動不管重算幾次都是同一列的同一分鐘，訂單編號才穩得住。
 *
 * 不會撞號：一台車不可能在同一分鐘做兩趟同方向的移動。
 */
function buildTripCode(
  direction: 'OUT' | 'IN',
  row: number,
  startMinute: number,
): string {
  return `MV${direction}-R${row}-${Math.round(startMinute * 60)}`;
}

/**
 * 抽出計畫中的全部空車移動卡。
 *
 * 連設施端都缺的卡會被跳過並記在 <code>skipped</code>——不下訂單，但也不靜默消失。
 * 只缺站點端的不算異常，交給排程層補。
 */
export function extractYardMoves(body: Record<string, unknown>): {
  moves: YardMove[];
  skipped: Array<{ blockId: string; reason: string }>;
} {
  const plan = asRecord(asRecord(body.scheduleOutput)?.plan);
  const timelines = plan?.timelines;
  const moves: YardMove[] = [];
  const skipped: Array<{ blockId: string; reason: string }> = [];
  if (!Array.isArray(timelines)) return { moves, skipped };

  for (const timeline of timelines) {
    const tl = asRecord(timeline);
    if (!tl || !Array.isArray(tl.blocks)) continue;

    for (const item of tl.blocks) {
      const block = asRecord(item);
      if (!block) continue;
      const source = str(block.source);
      if (source !== 'yard_exit_move' && source !== 'yard_entry_move') continue;

      const blockId = str(block.id) ?? '(無 id)';
      const startMinute = num(block.plannedStartMinute);
      const endMinute = num(block.plannedEndMinute);
      if (startMinute == null || endMinute == null) {
        skipped.push({ blockId, reason: '缺少計畫起訖時刻' });
        continue;
      }

      // 設施端有兩組欄位名。yardEntry* 只出現在「讓站移動」，那種卡沒有站點端。
      const facilityId =
        str(block.yardExitFacilityNodeId) ?? str(block.yardEntryFacilityNodeId);
      const facilityLabel =
        str(block.yardExitFacilityLabel) ?? str(block.yardEntryFacilityLabel);
      if (!facilityId) {
        skipped.push({
          blockId,
          reason: '空車移動缺少設施節點，無法決定場區端',
        });
        continue;
      }

      const stationId = str(block.yardExitStationId);
      const station: YardMoveEndpoint | null = stationId
        ? {
            id: stationId,
            name: str(block.yardExitStationLabel) ?? stationId,
            kind: 'station',
          }
        : null;
      const facility: YardMoveEndpoint = {
        id: facilityId,
        name: facilityLabel ?? facilityId,
        kind: 'facility',
      };

      // 出廠是從設施開往站點，入廠反過來。方向錯＝車開反方向。
      const outbound = source === 'yard_exit_move';
      const row = num(block.timelineRow) ?? 1;

      moves.push({
        blockId,
        timelineRow: row,
        tripCode: buildTripCode(outbound ? 'OUT' : 'IN', row, startMinute),
        label: str(block.label) ?? (outbound ? '整備出廠' : '整備入廠'),
        sectionCode: str(block.yardExitSectionCode),
        startMinute,
        endMinute,
        origin: outbound ? facility : station,
        destination: outbound ? station : facility,
      });
    }
  }

  return { moves, skipped };
}
