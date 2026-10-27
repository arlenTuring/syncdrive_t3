/**
 * 站點到站動態卡片的資料整理與文字（純函式，畫面只負責排版）。
 *
 * 時間一律是營運時間：事件的 at 與 useOperatingClock().operatingNow() 同一條時間軸，
 * 重播加速、暫停都跟著營運時鐘走，不另外拿 Date.now 算。
 */
import type { StationEtaWidget } from '../types';

/** 後端 /operation-metrics/station-eta 的一筆事件（backend/src/operation-metrics/station-eta.ts StationEvent） */
export type StationEvent = {
  key: string;
  /** 同一車、同一次停靠的穩定識別；到站轉出發時不變 */
  coupling_key?: string;
  row_key?: string;
  event: 'arrive' | 'depart';
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  vehicle_name?: string;
  /** 這班的任務標籤（正線為「上行」／「下行」） */
  task_label?: string;
  event_label?: string;
  /** 營運時刻（毫秒） */
  at: number;
  /** live：車端即時推估；plan：每日計畫時刻 */
  kind: 'live' | 'plan';
  /** 車已停在這一站（出發那一筆） */
  at_station: boolean;
  planned_at?: number | null;
  delay_seconds?: number | null;
  time_state?: 'countdown' | 'overdue' | 'due' | 'stale';
};

export type StationEventGroup = {
  station_id: string;
  station_name?: string;
  state: 'ok' | 'no_vehicle' | 'stale';
  events: StationEvent[];
  stale_vehicles: string[];
};

export type StationEtaResponse = {
  plan: { shift_id?: string; shift_name: string } | null;
  stations: StationEventGroup[];
  source?: string;
};

type StationConfig = StationEtaWidget['stations'][number];

/**
 * 即將到站的門檻：與後端 arrival_state 的 APPROACHING 同一個預設值
 * （backend/src/vehicle/eta/vehicle-eta.config.ts approachingEtaSeconds，60 秒）。
 * 只用在即時推估；計畫時刻不會因為快到了就說「即將到站」。
 */
export const APPROACHING_MS = 60_000;
/**
 * 計畫時刻過了這麼久、又沒有即時資料：後端下一次查詢就不會再列（station-eta.ts PLAN_EXPIRED_AFTER_MS）。
 * 前端在兩次查詢之間用同一個門檻先拿掉，只限計畫值；即時推估延誤了照樣留著。
 */
export const PLAN_EXPIRED_AFTER_MS = 30_000;
/**
 * 設計稿基準：卡片 320 寬、內容 254 高（正常三筆）時是 1×，所有字級、圖示、列高都乘同一個比例；
 * 卡片外框隨畫布既有縮放走，不另外 transform。
 */
export const STATION_ETA_DESIGN_WIDTH = 320;
/** 正常三筆（主卡＋兩列）內容要的高度（不含 1px 外框）：標題 44＋主卡 96＋(間距 6＋列 46)×2＋底部 10 */
export const STATION_ETA_DESIGN_HEIGHT = 254;

/**
 * 卡片比例：取寬 ÷ 320 與（高 − 外框）÷ 254 較小的那個，正常三筆一定排得下、不會因為卡片較寬就放大字；
 * 再乘字級設定 ÷ 12（12 是設計值＝1×，舊設定的 12 也就是 1×）。卡片比設計稿寬時，列跟著拉滿寬度。
 */
export function cardScale(width: number, height: number, fontSize?: number): number {
  const fit = Math.min(Math.max(1, width) / STATION_ETA_DESIGN_WIDTH, Math.max(1, height - 2) / STATION_ETA_DESIGN_HEIGHT);
  return fit * ((fontSize || 12) / 12);
}

/** 這一站要列哪幾種（舊設定沒有 events：只列到站） */
export function stationEvents(station: StationConfig): Array<'arrive' | 'depart'> {
  return station.events?.length ? station.events : ['arrive'];
}

/** 清單的網址：到站、出發的站點各自帶上 */
export function stationEtaUrl(widget: Pick<StationEtaWidget, 'dataUrl' | 'stations' | 'limit'>): string {
  const base = widget.dataUrl || '';
  const pick = (event: 'arrive' | 'depart') => widget.stations
    .filter((s) => s.stationId.trim() && stationEvents(s).includes(event))
    .map((s) => encodeURIComponent(s.stationId.trim()));
  const arrive = pick('arrive');
  const depart = pick('depart');
  if (!base || (arrive.length === 0 && depart.length === 0)) return '';
  const params = [
    arrive.length ? `arrive=${arrive.join(',')}` : '',
    depart.length ? `depart=${depart.join(',')}` : '',
    `limit=${Math.max(1, Math.min(10, widget.limit || 3))}`,
  ].filter(Boolean).join('&');
  return `${base}${base.includes('?') ? '&' : '?'}${params}`;
}

/** 剩餘秒數：無條件進位（還剩 1 毫秒也是 1 秒），過了就是 0 */
export function remainingSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * 剩餘時間 → 「分:秒」（總分鐘，不以 60 取模）：9 分 9 秒 → 09:09，120 分 5 秒 → 120:05。
 * 不是時刻，也不換成「時」。
 */
export function formatCountdown(ms: number): string {
  const total = remainingSeconds(ms);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type Direction = 'up' | 'down' | null;

/** 方向只看正式欄位 task_label（班次的上行／下行）；判不出來就是 null，不猜 */
export function directionOf(event: Pick<StationEvent, 'task_label'>): Direction {
  const label = event.task_label ?? '';
  if (label.includes('上行')) return 'up';
  if (label.includes('下行')) return 'down';
  return null;
}

/**
 * 方向／停靠點文字：屬性面板填的名稱優先，沒填用後端站名；名稱裡完全沒有上／下（如「T3」）才補上下行。
 * 「SW下停1」「NW上發2」這類站名本身已帶方向，不再重複補，卡片寬度留給站名本身。
 */
export function placeLabel(event: StationEvent, stations: StationConfig[]): string {
  const config = stations.find((s) => s.stationId === event.station_id);
  const name = config?.label && config.label !== config.stationId ? config.label : (event.station_name || event.station_id);
  const dir = event.task_label && directionOf(event) ? event.task_label : '';
  return dir && !/[上下]/.test(name) ? `${name} ${dir}` : name;
}

export type EventStatus = { text: string; tone: 'normal' | 'stale' };

/**
 * 卡片上一筆事件的短狀態（不含倒數）：到站與出發用不同說法，時間到了不等於已到站。
 * 卡片只畫動作，不畫誤點／延誤分鐘數、也不畫即時／計畫來源（誤點由班次表呈現，資料欄位照留）。
 */
export function eventStatus(event: StationEvent, operatingNow: number): EventStatus {
  const remain = event.at - operatingNow;
  if (event.time_state === 'stale') return { text: '資料中斷', tone: 'stale' };
  if (event.event === 'depart') {
    if (remain > 0) return { text: event.at_station ? '停靠中 出發倒數' : '出發倒數', tone: 'normal' };
    return { text: '即將出發', tone: 'normal' };
  }
  if (remain <= 0 || (event.kind === 'live' && remain <= APPROACHING_MS)) return { text: '即將到站', tone: 'normal' };
  return { text: '到站倒數', tone: 'normal' };
}

/**
 * 後續列的短標記（列寬有限）：出發的列標「出發」、資料中斷標「資料中斷」；到站不標，倒數本身就是到站。
 * 主卡的完整狀態（即將出發等）見 eventStatus。
 */
export function rowTag(event: StationEvent): EventStatus | null {
  if (event.time_state === 'stale') return { text: '資料中斷', tone: 'stale' };
  if (event.event !== 'depart') return null;
  return { text: '出發', tone: 'normal' };
}

/**
 * 要顯示的列：同一車同一次停靠（row_key）只留一筆；計畫值過期先拿掉（與後端同門檻），
 * 即時與停靠中的不拿；依時刻排，平手用 key，順序不會每秒跳。
 */
export function visibleEvents(response: StationEtaResponse | null, operatingNow: number, limit: number): StationEvent[] {
  const seen = new Set<string>();
  return (response?.stations ?? [])
    .flatMap((group) => group.events ?? [])
    .filter((e) => e.kind === 'live' || e.at_station || e.at >= operatingNow - PLAN_EXPIRED_AFTER_MS)
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .filter((e) => {
      const id = e.row_key || e.key;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, Math.max(1, Math.min(10, limit || 3)));
}

/** 卡片最多幾列（設計稿高度排得下：一張大卡＋兩列、或三列小列、或兩張大卡） */
export const STATION_ETA_MAX_ROWS = 3;

/** 即將到站（即時 60 秒內或時間已到）的到站列放大顯示；出發、資料中斷不放大 */
export function isImminentArrival(event: StationEvent, operatingNow: number): boolean {
  return event.event === 'arrive' && eventStatus(event, operatingNow).text === '即將到站';
}

export type CardRow = { event: StationEvent; big: boolean };

/**
 * 卡片上的列：照時刻由近到遠，最多三列（再受屬性「最多幾筆」限制）；即將到站的放大。
 * 兩張大卡就佔滿高度，所以同時有兩班（以上）即將到站時只排前兩列。
 */
export function cardRows(rows: StationEvent[], operatingNow: number): CardRow[] {
  const out = rows.slice(0, STATION_ETA_MAX_ROWS).map((event) => ({ event, big: isImminentArrival(event, operatingNow) }));
  return out.filter((r) => r.big).length >= 2 ? out.slice(0, 2) : out;
}

export type CardMessage = { text: string; tone: 'muted' | 'warn' | 'error'; detail?: string };

/** 沒有列可以顯示時的說明；正常沒車、未部署、過期、失敗各自不同 */
export function cardMessage(args: {
  url: string;
  isEditMode: boolean;
  response: StationEtaResponse | null;
  loading: boolean;
  error: string | null;
  rows: number;
}): CardMessage | null {
  const { url, isEditMode, response, loading, error, rows } = args;
  if (!url) return { text: '未設定站點', tone: 'warn', detail: isEditMode ? '在右側屬性面板填入停靠點（站點 ID）' : undefined };
  if (error && !response) return { text: '資料載入失敗', tone: 'error', detail: error };
  if (!response) return loading ? { text: '載入中…', tone: 'muted' } : null;
  if (rows > 0) return null;
  if (!response.plan) return { text: '尚未部署每日計畫', tone: 'muted' };
  const stale = [...new Set(response.stations.flatMap((g) => g.stale_vehicles ?? []))];
  if (stale.length || response.stations.some((g) => g.state === 'stale')) {
    return { text: '車端資料過期', tone: 'warn', detail: stale.length ? `資料過期：${stale.join('、')}` : undefined };
  }
  return { text: '暫無資料', tone: 'muted' };
}

/**
 * 下一次畫面要換數字的時間（真實毫秒）。倒數用無條件進位，剩 ms 毫秒時下一次跳字在
 * ms % 1000 之後；營運時鐘倍速時換算成真實時間。暫停時每秒看一次就好（數字不會動）。
 */
export function nextTickDelay(ats: number[], operatingNow: number, rate: number, advancing: boolean): number {
  if (!advancing || rate <= 0) return 1000;
  let next = 1000;
  for (const at of ats) {
    const ms = at - operatingNow;
    if (ms <= 0) continue;
    next = Math.min(next, ms % 1000 || 1000);
  }
  const real = next / rate + 5;
  return Math.min(1000, Math.max(rate > 1 ? 100 : 20, real));
}
