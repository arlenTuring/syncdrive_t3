/**
 * 車輛即時 ETA 部署配置參數。
 *
 * 值與名稱對應《車輛即時 ETA API 規格書》第十二章——規格書寫明這些是<strong>部署時
 * 可調</strong>的參數，所以一律讀環境變數、預設值照規格。硬寫在程式裡的話，現場要調
 * 門檻就得改版重佈，而規格已經對外承諾可調。
 */
function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

export const vehicleEtaConfig = {
  /** arrival_state 轉 APPROACHING 的時間門檻（秒） */
  get approachingEtaSeconds(): number {
    return envInt('APPROACHING_ETA_THRESHOLD_SECONDS', 60);
  },
  /** arrival_state 轉 APPROACHING 的距離門檻（公尺） */
  get approachingDistanceM(): number {
    return envInt('APPROACHING_DISTANCE_THRESHOLD_M', 200);
  },
  /** delay_state 轉 EARLY 的門檻（秒，負值） */
  get earlySeconds(): number {
    return envInt('EARLY_THRESHOLD_SECONDS', -30);
  },
  /** delay_state 轉 MINOR_DELAY 的門檻（秒） */
  get minorDelaySeconds(): number {
    return envInt('MINOR_DELAY_THRESHOLD_SECONDS', 60);
  },
  /** delay_state 轉 MAJOR_DELAY 的門檻（秒） */
  get majorDelaySeconds(): number {
    return envInt('MAJOR_DELAY_THRESHOLD_SECONDS', 180);
  },
  /** 資料逾時門檻（秒）；超過即 arrival_state = UNKNOWN */
  get dataStaleSeconds(): number {
    return envInt('DATA_STALE_THRESHOLD_SECONDS', 90);
  },
  /** by-station 每站預設回傳筆數 */
  get defaultLimitPerStation(): number {
    return envInt('DEFAULT_LIMIT_PER_STATION', 3);
  },
  /** by-vehicle 每車預設推算站數 */
  get defaultNextStops(): number {
    return envInt('DEFAULT_NEXT_STOPS', 3);
  },
};

/** 規格書 5.1／6.1：兩個筆數參數的值域都是 1–10 */
export const ETA_COUNT_PARAM_MIN = 1;
export const ETA_COUNT_PARAM_MAX = 10;
