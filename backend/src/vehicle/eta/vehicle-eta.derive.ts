import { vehicleEtaConfig } from './vehicle-eta.config';

/**
 * 由車端回報推導出對外欄位的純函式。
 *
 * 這裡是規格書第七章的實作。全部做成不碰 Redis、不碰資料庫的純函式，是因為它們
 * 是<strong>對外承諾的判定規則</strong>——門檻怎麼算、逾時怎麼判，廠商會照這份規格
 * 寫他們的顯示邏輯。要驗證這些規則不該需要起一個資料庫。
 */

export type ArrivalState =
  | 'EN_ROUTE'
  | 'APPROACHING'
  | 'DOCKING'
  | 'AT_STATION'
  | 'DEPARTED'
  | 'UNKNOWN';

export type DelayState =
  | 'EARLY'
  | 'ON_TIME'
  | 'MINOR_DELAY'
  | 'MAJOR_DELAY'
  | 'NO_PLAN';

export type DataQuality = 'OK' | 'DEGRADED' | 'DOWN';

/** 營運任務狀態協議的任務項；只取判定 arrival_state 用得到的欄位 */
export type TaskGroupItem = {
  task_name?: string;
  status?: string;
};

/**
 * 規格書 7.7：arrival_state。
 *
 * 判定順序有意義，不能重排：
 *
 * <ol>
 *   <li><strong>逾時最優先</strong>——資料太舊時，任何由它推出來的狀態都不可信，
 *       包括「看起來剛好停在站上」。</li>
 *   <li>車端任務狀態次之。停靠、開關門、離站是車端<strong>觀測到的事實</strong>，
 *       比我方用門檻推出來的接近程度可靠。</li>
 *   <li>最後才用 eta／距離門檻分 APPROACHING 與 EN_ROUTE。</li>
 * </ol>
 */
export function resolveArrivalState(args: {
  dataAgeSeconds: number;
  targetStationId: string | null;
  /** 這一筆要判定的停靠點；不是車端當前目標站時，任務狀態不適用 */
  stationId: string;
  etaSeconds: number | null;
  distanceM: number | null;
  taskGroup?: TaskGroupItem[] | null;
}): ArrivalState {
  const { dataAgeSeconds, targetStationId, stationId, etaSeconds, distanceM } =
    args;

  if (dataAgeSeconds > vehicleEtaConfig.dataStaleSeconds) return 'UNKNOWN';
  if (!targetStationId) return 'UNKNOWN';

  // 任務狀態只描述車端「當前目標站」的進度，套到別站是錯的
  if (targetStationId === stationId) {
    const byTask = resolveArrivalStateFromTasks(args.taskGroup);
    if (byTask) return byTask;
  }

  if (etaSeconds == null && distanceM == null) return 'UNKNOWN';
  const nearInTime =
    etaSeconds != null && etaSeconds <= vehicleEtaConfig.approachingEtaSeconds;
  const nearInSpace =
    distanceM != null && distanceM <= vehicleEtaConfig.approachingDistanceM;
  return nearInTime || nearInSpace ? 'APPROACHING' : 'EN_ROUTE';
}

/**
 * 從 task_group 讀出停靠進度。
 *
 * 規格書 7.7 指名四個任務：PLATFORM_DOCKING 進行中＝對位中；OPEN_DOORS 完成且
 * CLOSE_DOORS 尚未觸發＝停靠中；STATION_DEPARTURE 完成＝已離站。判定由晚到早，
 * 因為同一次靠站的任務會逐一累積成 COMPLETED，最晚發生的那個才是現在的狀態。
 */
function resolveArrivalStateFromTasks(
  taskGroup: TaskGroupItem[] | null | undefined,
): ArrivalState | null {
  if (!taskGroup?.length) return null;
  const statusOf = (name: string): string | null => {
    const hit = taskGroup.find((task) => task.task_name === name);
    return hit?.status ?? null;
  };

  if (statusOf('STATION_DEPARTURE') === 'COMPLETED') return 'DEPARTED';
  if (
    statusOf('OPEN_DOORS') === 'COMPLETED' &&
    statusOf('CLOSE_DOORS') !== 'COMPLETED' &&
    statusOf('CLOSE_DOORS') !== 'IN_PROGRESS'
  ) {
    return 'AT_STATION';
  }
  if (statusOf('PLATFORM_DOCKING') === 'IN_PROGRESS') return 'DOCKING';
  return null;
}

/** 規格書 7.10：delay_state。門檻可由部署參數調整，級距的開閉區間照規格。 */
export function resolveDelayState(delaySeconds: number | null): DelayState {
  if (delaySeconds == null) return 'NO_PLAN';
  if (delaySeconds < vehicleEtaConfig.earlySeconds) return 'EARLY';
  if (delaySeconds <= vehicleEtaConfig.minorDelaySeconds) return 'ON_TIME';
  if (delaySeconds <= vehicleEtaConfig.majorDelaySeconds) return 'MINOR_DELAY';
  return 'MAJOR_DELAY';
}

/**
 * 規格書 7.3：data_quality。
 *
 * 判定基礎是<strong>車隊應有的車輛清單</strong>，不是「有回報的車」——完全沒回報的
 * 車必須算進分母，否則全隊失聯會因為分母同時歸零而看起來一切正常。
 */
export function resolveDataQuality(args: {
  fleetSize: number;
  freshCount: number;
}): DataQuality {
  if (args.fleetSize <= 0) return 'DOWN';
  if (args.freshCount <= 0) return 'DOWN';
  if (args.freshCount < args.fleetSize) return 'DEGRADED';
  return 'OK';
}

/** 規格書 7.11：data_age_seconds＝generated_at − observed_at，不取負值 */
export function dataAgeSeconds(
  generatedAt: number,
  observedAt: number,
): number {
  return Math.max(0, Math.round((generatedAt - observedAt) / 1000));
}
