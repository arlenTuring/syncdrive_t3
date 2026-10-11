/**
 * 即時時間軸一次渲染的「現在」基準。
 * ================================================
 *
 * 以前整張圖以瀏覽器推算的營運時間為現在，資料點則是後端某一刻算好的。兩個時鐘差一點點：
 * - 後端「現在」那一列比瀏覽器的現在晚了幾秒，就被當成未來的點排除，端點退回前一個 10 分鐘
 *   取樣格，下一輪又跳回來——實測端點在 x=190 與 205 之間來回（10 倍速重播、每 3 秒刷新）。
 * - 資料兩次刷新之間，瀏覽器時鐘照走，整條線跟著往左滑，刷新後再跳回。
 *
 * 現在的規則：
 * - 資料帶了「現在」那一列（is_now）與採樣時刻（now_ms）時，整張圖用這個採樣時刻當現在：
 *   虛線、端點、刻度、色帶同一個基準，端點就是那一列，固定在視窗的現在位置。
 * - 採樣時刻跟營運時鐘差太多（資料落後、或時鐘重設／換一次重播）：改用營運時鐘當現在，
 *   資料照它真實的時間畫，標示資料時間與落後多久，不把舊採樣當成現在值。落後的「現在」那列
 *   照它的時間畫在虛線左邊；比時鐘還新的資料（時鐘還沒同步）不畫端點，不提前使用未來的值。
 * - 沒有 is_now 的資料（一般查詢）維持原規則：主線最後一個不在未來的點。
 */

export type ChartNowAnchor = {
  /** 這次渲染的「現在」（營運時間，Epoch 毫秒） */
  anchorMs: number;
  /** 資料「現在」那一列的索引；沒有時是 -1 */
  nowRowIndex: number;
  /** 資料的採樣時刻；資料沒帶時是 null */
  dataNowMs: number | null;
  /** 採樣時刻跟營運時鐘差多少（正數＝資料落後） */
  lagMs: number;
  /** fresh：用資料的採樣時刻；stale：資料落後；ahead：資料比時鐘新（時鐘還沒同步）；none：資料沒帶現在 */
  status: 'fresh' | 'stale' | 'ahead' | 'none';
};

function truthy(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function epochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 容許的時鐘差（營運毫秒）：三次刷新的時間（倍速下乘上倍率），至少 1 分鐘。
 * 刷新一次之內的差是正常的請求往返與時鐘推算誤差，不算落後。
 */
export function chartNowToleranceMs(rate: number, refreshIntervalSec: number | undefined): number {
  const refreshMs = Math.max(10_000, (refreshIntervalSec && refreshIntervalSec > 0 ? refreshIntervalSec : 10) * 3_000);
  return Math.max(60_000, Math.max(1, rate) * refreshMs);
}

export function resolveChartNowAnchor(
  data: ReadonlyArray<Record<string, unknown>>,
  clockNowMs: number,
  toleranceMs: number,
): ChartNowAnchor {
  const nowRowIndex = data.findIndex((row) => truthy(row.is_now));
  const dataNowMs = nowRowIndex >= 0 ? epochMs(data[nowRowIndex].now_ms) : null;
  if (dataNowMs === null) {
    return { anchorMs: clockNowMs, nowRowIndex, dataNowMs: null, lagMs: 0, status: 'none' };
  }
  const lagMs = clockNowMs - dataNowMs;
  if (Math.abs(lagMs) <= toleranceMs) {
    return { anchorMs: dataNowMs, nowRowIndex, dataNowMs, lagMs, status: 'fresh' };
  }
  return { anchorMs: clockNowMs, nowRowIndex, dataNowMs, lagMs, status: lagMs > 0 ? 'stale' : 'ahead' };
}
