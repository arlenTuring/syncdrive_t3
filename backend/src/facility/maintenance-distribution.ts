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
 * 車輛分佈
 * ========
 *
 * 每台車此刻歸哪一類，跟整備分佈用同一套判斷，兩塊才不會互相矛盾：
 *
 * 1. 有進行中的訂單：正線（MAINLINE／TEST）→ 營運中；空車移動（出入廠、讓站）→ 整備中；
 *    整備訂單照它的整備區塊——待命 → 待命中，其餘 → 整備中。
 * 2. 沒有進行中的訂單：整備分佈裡亮在「待命以外」某一類的車（停在格位裡、照班表正在
 *    整備）→ 整備中；其他 → 待命中。
 *
 * 舊版的「整備中」讀 slot_statuses 示範表，接真車或模擬器時永遠不會變。
 */
export type VehicleDistributionStatus = 'IN_SERVICE' | 'MAINTENANCE' | 'STANDBY';

export type VehicleDistributionRow = {
  status_code: VehicleDistributionStatus;
  pct: number;
  vehicle_count: number;
};

const STATUS_ORDER: VehicleDistributionStatus[] = ['IN_SERVICE', 'MAINTENANCE', 'STANDBY'];

export function buildVehicleDistribution(args: {
  fleetCodes: string[];
  /** 進行中的訂單（每台車最新一筆） */
  processingOrders: Array<{
    vehicleCode: string;
    lineKind: string | null;
    kind: string | null;
    taskType: string | null;
    cardLabel: string | null;
  }>;
  /** 同一時刻的整備分佈（已依訂單／班表判定好每格的車算哪一類） */
  maintenance: MaintenanceDistribution;
}): VehicleDistributionRow[] {
  const sectionByLabel = new Map(args.maintenance.categories.map((category) => [category.label, category.key] as const));
  const orderByVehicle = new Map(args.processingOrders.map((order) => [order.vehicleCode, order]));
  const inMaintenanceSlot = new Set<string>();
  for (const category of args.maintenance.categories) {
    if (category.key === 'mobile') continue;
    for (const slot of category.slots) {
      if (slot.occupied && slot.vehicleCode) inMaintenanceSlot.add(slot.vehicleCode);
    }
  }

  const statusOf = (vehicleCode: string): VehicleDistributionStatus => {
    const order = orderByVehicle.get(vehicleCode);
    if (order) {
      const lineKind = (order.lineKind ?? '').toUpperCase();
      if (lineKind === 'MAINLINE' || lineKind === 'TEST') return 'IN_SERVICE';
      if (order.kind === 'movement') return 'MAINTENANCE';
      const section = (order.taskType ? SECTION_BY_TASK_TYPE[order.taskType] : undefined)
        ?? (order.cardLabel ? sectionByLabel.get(order.cardLabel.trim()) : undefined);
      return section === 'mobile' ? 'STANDBY' : 'MAINTENANCE';
    }
    return inMaintenanceSlot.has(vehicleCode) ? 'MAINTENANCE' : 'STANDBY';
  };

  const counts = new Map<VehicleDistributionStatus, number>();
  const fleet = [...new Set(args.fleetCodes.filter(Boolean))];
  for (const code of fleet) {
    const status = statusOf(code);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return STATUS_ORDER
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => ({
      status_code: status,
      pct: Math.round((1000 * (counts.get(status) ?? 0)) / Math.max(1, fleet.length)) / 10,
      vehicle_count: counts.get(status) ?? 0,
    }));
}
