/**
 * 整備分佈
 * ========
 *
 * 儀表板「整備分佈」那一塊的資料。三個來源各管一件事：
 *
 * <table>
 *   <tr><td>有哪幾類、各叫什麼</td><td>部署中班表的整備區塊（啟用的才算）與卡片名稱</td></tr>
 *   <tr><td>每一類有哪幾格</td><td>班表綁定的整備任務，各區塊設備列的格位代號；只留地圖上真的有的設施格</td></tr>
 *   <tr><td>哪一格有車</td><td>車輛即時位置（中心端依 telemetry 判定、寫在 vehicle_monitor_demo）</td></tr>
 * </table>
 *
 * 舊版讀的是 facility_slots／slot_statuses 兩張示範表：格位寫死（E／W／M／H／P）、
 * 狀態只有示範模擬會寫，接真車或模擬器時永遠是 0。
 *
 * 同一格可能同時屬於幾類（例：M1 既是行檢格、也是待命可停的格）。車停在那裡時只亮在
 * 它<strong>正在做的整備</strong>那一類：先看進行中的整備訂單，沒有就看部署班表此刻排給
 * 這台車的整備卡；都沒有就當作待命（待命清單有這一格的話），否則歸到第一個列出這一格的區塊。
 */

export const MAINTENANCE_SECTION_KEYS = ['charging', 'carWash', 'maintenance', 'preTrip', 'mobile'] as const;
export type MaintenanceSectionKey = (typeof MAINTENANCE_SECTION_KEYS)[number];

const DEFAULT_SECTION_LABEL: Record<MaintenanceSectionKey, string> = {
  charging: '充電',
  carWash: '洗車',
  maintenance: '保養',
  preTrip: '行檢',
  mobile: '待命',
};

/** 班表整備卡的 taskType → 整備區塊（與排班引擎、調度引擎同一組對應） */
const SECTION_BY_TASK_TYPE: Record<string, MaintenanceSectionKey> = {
  charging: 'charging',
  washing: 'carWash',
  servicing: 'maintenance',
  inspection: 'preTrip',
  standby: 'mobile',
};

export type MaintenanceDistributionSlot = {
  /** 格位代號（地圖上的設施名稱，例 E1） */
  code: string;
  /** 地圖設施 id */
  facilityId: string;
  /** 有車停在這一格、且車正在做的是這一類整備 */
  occupied: boolean;
  vehicleCode: string | null;
};

export type MaintenanceDistributionCategory = {
  key: MaintenanceSectionKey;
  label: string;
  /** 班表設定的區塊代號（例 E） */
  code: string;
  occupiedCount: number;
  slots: MaintenanceDistributionSlot[];
};

export type MaintenanceDistribution = {
  shiftId: string | null;
  shiftName: string | null;
  /** 有車的類別數／類別總數（標題右側） */
  activeCategories: number;
  totalCategories: number;
  headerLine: string;
  categories: MaintenanceDistributionCategory[];
  /** 沒有資料時的原因（例：沒有部署中的班表） */
  message: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 字母＋數字的自然排序：E2 在 E10 前面 */
function compareSlotCode(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function buildMaintenanceDistribution(args: {
  shift: { shiftId: string; shiftName: string; body: Record<string, unknown> } | null;
  /** 班表綁定的整備任務內容（各區塊的 equipmentRows） */
  maintenanceBody: Record<string, unknown> | null;
  /** 地圖上的設施（格位代號 ↔ 設施 id） */
  facilities: Array<{ mapCode: string; equipmentId: string }>;
  /** 停在設施裡的車 */
  vehicleLocations: Array<{ vehicleCode: string; facilityId: string }>;
  /**
   * 各車進行中的整備訂單：taskType 是班表整備卡的任務類型；舊訂單沒有這個欄位時用
   * cardLabel（班表設定的區塊卡片名稱）對回區塊
   */
  currentTasks: Array<{ vehicleCode: string; taskType: string | null; cardLabel?: string | null }>;
  /** 沒有進行中訂單時的備援：部署班表此刻排給這台車的整備卡任務類型 */
  plannedTasks?: Array<{ vehicleCode: string; taskType: string | null }>;
}): MaintenanceDistribution {
  const empty = (message: string): MaintenanceDistribution => ({
    shiftId: args.shift?.shiftId ?? null,
    shiftName: args.shift?.shiftName ?? null,
    activeCategories: 0,
    totalCategories: 0,
    headerLine: '0 / 0',
    categories: [],
    message,
  });
  const shift = args.shift;
  if (!shift) return empty('目前沒有部署中的班表');
  const body = shift.body;
  if (body.maintenanceTaskSkipped === true) return empty('部署中的班表沒有綁定整備任務');

  const enabled = asRecord(body.maintenanceSectionEnabled);
  const labels = asRecord(body.maintenanceSectionCardLabelBySection);
  const codes = asRecord(body.maintenanceSectionCodeBySection);
  const maintenanceBody = args.maintenanceBody ?? {};

  const facilityByCode = new Map<string, string>();
  const codeByFacilityId = new Map<string, string>();
  for (const facility of args.facilities) {
    const code = str(facility.mapCode);
    const id = str(facility.equipmentId);
    if (!code || !id) continue;
    facilityByCode.set(code.toUpperCase(), id);
    codeByFacilityId.set(id, code.toUpperCase());
  }

  // 各區塊的格位：設備列裡、而且地圖上真的有這個設施的（待命清單也列了正線月台，那不是格位）
  const sections = MAINTENANCE_SECTION_KEYS
    .filter((key) => enabled?.[key] !== false)
    .map((key) => {
      const rows = asRecord(maintenanceBody[key])?.equipmentRows;
      const slotCodes = [...new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => str(asRecord(row)?.mapCode)?.toUpperCase() ?? null)
          .filter((code): code is string => code != null && facilityByCode.has(code)),
      )].sort(compareSlotCode);
      return {
        key,
        label: str(labels?.[key]) ?? DEFAULT_SECTION_LABEL[key],
        code: str(codes?.[key]) ?? '',
        slotCodes,
      };
    });

  const sectionsBySlot = new Map<string, MaintenanceSectionKey[]>();
  for (const section of sections) {
    for (const code of section.slotCodes) {
      sectionsBySlot.set(code, [...(sectionsBySlot.get(code) ?? []), section.key]);
    }
  }
  const sectionByLabel = new Map(sections.map((section) => [section.label, section.key] as const));
  const taskByVehicle = new Map<string, MaintenanceSectionKey>();
  for (const task of args.plannedTasks ?? []) {
    const section = task.taskType ? SECTION_BY_TASK_TYPE[task.taskType] : undefined;
    if (section) taskByVehicle.set(task.vehicleCode, section);
  }
  // 實際進行中的訂單優先於計畫
  for (const task of args.currentTasks) {
    const section = (task.taskType ? SECTION_BY_TASK_TYPE[task.taskType] : undefined)
      ?? (task.cardLabel ? sectionByLabel.get(task.cardLabel.trim()) : undefined);
    if (section) taskByVehicle.set(task.vehicleCode, section);
  }

  // 格位 → 停在裡面的車與它算在哪一類
  const occupancy = new Map<string, { vehicleCode: string; section: MaintenanceSectionKey }>();
  const locations = [...args.vehicleLocations].sort((a, b) => a.vehicleCode.localeCompare(b.vehicleCode));
  for (const location of locations) {
    const code = codeByFacilityId.get(location.facilityId);
    if (!code || occupancy.has(code)) continue;
    const candidates = sectionsBySlot.get(code);
    if (!candidates?.length) continue;
    const doing = taskByVehicle.get(location.vehicleCode) ?? null;
    const section = doing && candidates.includes(doing)
      ? doing
      : !doing && candidates.includes('mobile')
        ? 'mobile'
        : candidates[0]!;
    occupancy.set(code, { vehicleCode: location.vehicleCode, section });
  }

  const categories: MaintenanceDistributionCategory[] = sections.map((section) => {
    const slots = section.slotCodes.map((code) => {
      const hit = occupancy.get(code);
      const occupied = hit?.section === section.key;
      return {
        code,
        facilityId: facilityByCode.get(code)!,
        occupied,
        vehicleCode: occupied ? hit!.vehicleCode : null,
      };
    });
    return {
      key: section.key,
      label: section.label,
      code: section.code,
      occupiedCount: slots.filter((slot) => slot.occupied).length,
      slots,
    };
  });
  const activeCategories = categories.filter((category) => category.occupiedCount > 0).length;
  return {
    shiftId: shift.shiftId,
    shiftName: shift.shiftName,
    activeCategories,
    totalCategories: categories.length,
    headerLine: `${activeCategories} / ${categories.length}`,
    categories,
    message: categories.length === 0 ? '部署中的班表沒有啟用任何整備區塊' : null,
  };
}

const YARD_TASK_TYPES = new Set(Object.keys(SECTION_BY_TASK_TYPE));
const DAY_MINUTES = 24 * 60;

/** 台北時間的當日分鐘（班表時刻的座標） */
export function taipeiMinuteOfDay(now = Date.now()): number {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60;
}

/**
 * 部署班表此刻排給各車的整備卡（充電／洗車／保養／行檢／待命）。
 *
 * 時間線第 N 列＝車隊依代號排序的第 N 台——跟調度引擎派單用的是同一個對應
 * （dispatch-engine.service loadFleet），所以這裡看到的就是「照班表這台車現在該在做什麼」。
 */
export function plannedYardTasksNow(
  body: Record<string, unknown>,
  fleetCodes: string[],
  now = Date.now(),
): Array<{ vehicleCode: string; taskType: string | null }> {
  const timelines = asRecord(asRecord(body.scheduleOutput)?.plan)?.timelines;
  if (!Array.isArray(timelines)) return [];
  const fleet = [...fleetCodes].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const minute = taipeiMinuteOfDay(now);
  const out: Array<{ vehicleCode: string; taskType: string | null }> = [];
  for (const raw of timelines) {
    const timeline = asRecord(raw);
    const row = typeof timeline?.row === 'number' ? timeline.row : null;
    const vehicleCode = row != null ? fleet[row - 1] : undefined;
    if (!vehicleCode || !Array.isArray(timeline?.blocks)) continue;
    for (const rawBlock of timeline.blocks) {
      const block = asRecord(rawBlock);
      const taskType = str(block?.taskType);
      if (!block || !taskType || !YARD_TASK_TYPES.has(taskType)) continue;
      const start = Number(block.plannedStartMinute);
      const end = Number(block.plannedEndMinute);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      // 跨午夜的卡記成 1440 以上，同時比對今天與「昨天延續到今天」的那一段
      const inside = [minute, minute + DAY_MINUTES].some((at) => at >= start && at < end);
      if (inside) {
        out.push({ vehicleCode, taskType });
        break;
      }
    }
  }
  return out;
}

/**
 * 營運分佈：每台車此刻只歸一類——營運中、整備中、待命中。
 *
 * 依「此刻有效的那張任務」的<strong>用途</strong>分，不看車速、訂單是否還沒開始、停在哪一格、
 * 卡片文字或代號開頭：
 *
 * <table>
 *   <tr><td>正線班次（MAINLINE；人工測試 TEST 照舊算營運）</td><td>營運中</td></tr>
 *   <tr><td>充電、洗車、保養、行檢</td><td>整備中</td></tr>
 *   <tr><td>過渡任務（出廠、入廠、暫停、待命）</td><td>依它服務的用途（payload.service_purpose，
 *     排班展開時決定；舊單由同一份班表時間線補算）：營運→營運中、整備→整備中、待命→待命中</td></tr>
 *   <tr><td>此刻沒有有效任務</td><td>待命中</td></tr>
 * </table>
 *
 * 「此刻有效」由呼叫端判定（執行中且仍有回報、或計畫時間窗涵蓋此刻）；已結束、取消、過期的單
 * 不傳進來。「營運中」是承接營運任務，不等於正在載客。
 */
export type VehicleDistributionStatus = 'IN_SERVICE' | 'MAINTENANCE' | 'STANDBY';

export type VehicleDistributionRow = {
  status_code: VehicleDistributionStatus;
  pct: number;
  vehicle_count: number;
  /**
   * 這一類的車與歸類原因。dispatchable＝此刻沒有承接任何任務、也不是「計畫有任務但還沒訂單」，
   * 可以臨時調度去營運（運能摘要的「可調度」數量看它，不直接拿待命中的總數）。
   */
  vehicles: Array<{ vehicle_code: string; reason: string; dispatchable: boolean }>;
};

const STATUS_ORDER: VehicleDistributionStatus[] = ['IN_SERVICE', 'MAINTENANCE', 'STANDBY'];

export type CurrentVehicleTask = {
  vehicleCode: string;
  orderId: string;
  tripCode: string | null;
  /** 業務分類（order-business-kind）：MAINLINE／TRANSITION／MAINTENANCE／TEST */
  businessKind: string | null;
  /** 原任務子類型（passenger、charging、standby、idle、dispatch…） */
  taskType: string | null;
  /** 過渡任務服務的用途；舊單沒存時由呼叫端從班表時間線補 */
  servicePurpose: 'operation' | 'maintenance' | 'standby' | null;
  /** 補算來源，寫進原因 */
  purposeSource: 'order' | 'shift' | null;
  /**
   * 沒有有效訂單時，每日計畫此刻的那張卡（訂單欄位此時為空）。
   * ordersExpected：這種卡本來就該有訂單（載客、場區整備、出入廠）——有計畫沒訂單，照實標示，不拿計畫冒充實際。
   */
  planBlock?: { taskType: string; ordersExpected: boolean };
};

const TASK_WORD: Record<string, string> = {
  passenger: '載客', charging: '充電', washing: '洗車', servicing: '保養', inspection: '行檢',
  standby: '待命', idle: '暫停', dispatch: '空車移動',
};

const PURPOSE_WORD = { operation: '營運', maintenance: '整備', standby: '待命' } as const;
const PURPOSE_STATUS = { operation: 'IN_SERVICE', maintenance: 'MAINTENANCE', standby: 'STANDBY' } as const;

export function classifyVehicle(task: CurrentVehicleTask | undefined): { status: VehicleDistributionStatus; reason: string } {
  if (!task) return { status: 'STANDBY', reason: '此刻沒有有效任務' };
  if (task.planBlock) {
    const word = TASK_WORD[task.planBlock.taskType] ?? task.planBlock.taskType;
    if (task.planBlock.ordersExpected) {
      return { status: 'STANDBY', reason: `每日計畫此刻是「${word}」，但沒有有效訂單` };
    }
    if (task.servicePurpose) {
      return {
        status: PURPOSE_STATUS[task.servicePurpose],
        reason: `每日計畫：${word}（不產生訂單的等待），服務${PURPOSE_WORD[task.servicePurpose]}`,
      };
    }
    return { status: 'STANDBY', reason: `每日計畫此刻是「${word}」，用途不明` };
  }
  const kind = (task.businessKind ?? '').toUpperCase();
  const label = `${task.tripCode ?? task.orderId}（${TASK_WORD[task.taskType ?? ''] ?? task.taskType ?? '未知任務'}）`;
  if (kind === 'MAINLINE' || kind === 'TEST') return { status: 'IN_SERVICE', reason: `正線任務 ${label}` };
  if (kind === 'MAINTENANCE') return { status: 'MAINTENANCE', reason: `整備任務 ${label}` };
  if (kind === 'TRANSITION') {
    const from = task.purposeSource === 'shift' ? '（用途由班表時間線補算）' : '';
    if (task.servicePurpose === 'operation') return { status: 'IN_SERVICE', reason: `過渡 ${label} 服務營運${from}` };
    if (task.servicePurpose === 'maintenance') return { status: 'MAINTENANCE', reason: `過渡 ${label} 服務整備${from}` };
    if (task.servicePurpose === 'standby') return { status: 'STANDBY', reason: `過渡 ${label} 服務待命${from}` };
    return { status: 'STANDBY', reason: `過渡 ${label} 用途不明（訂單與班表都沒有），不算營運或整備` };
  }
  return { status: 'STANDBY', reason: `任務 ${label} 分類不明（${task.businessKind ?? '無'}）` };
}

export function buildVehicleDistribution(args: {
  fleetCodes: string[];
  /** 每台車此刻有效的那一張任務（沒有就不放） */
  currentTasks: CurrentVehicleTask[];
}): VehicleDistributionRow[] {
  const taskByVehicle = new Map(args.currentTasks.map((task) => [task.vehicleCode, task]));
  const groups = new Map<VehicleDistributionStatus, VehicleDistributionRow['vehicles']>();
  const fleet = [...new Set(args.fleetCodes.filter(Boolean))];
  for (const code of fleet) {
    const task = taskByVehicle.get(code);
    const { status, reason } = classifyVehicle(task);
    const list = groups.get(status) ?? [];
    list.push({ vehicle_code: code, reason, dispatchable: status === 'STANDBY' && !task?.planBlock?.ordersExpected });
    groups.set(status, list);
  }
  return STATUS_ORDER
    .filter((status) => (groups.get(status)?.length ?? 0) > 0)
    .map((status) => ({
      status_code: status,
      pct: Math.round((1000 * (groups.get(status)?.length ?? 0)) / Math.max(1, fleet.length)) / 10,
      vehicle_count: groups.get(status)?.length ?? 0,
      vehicles: groups.get(status) ?? [],
    }));
}
