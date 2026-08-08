import {
  isPositiveInteger,
  isPositiveIntegerBelow,
  isPositiveIntegerUpTo,
} from '../utils/numericInput';

export type CreateMaintenanceTaskStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const CREATE_MAINTENANCE_TASK_STEPS: Array<{
  step: CreateMaintenanceTaskStep;
  label: string;
}> = [
  { step: 1, label: '基本資料' },
  { step: 2, label: '充電任務' },
  { step: 3, label: '洗車任務' },
  { step: 4, label: '保養任務' },
  { step: 5, label: '調度任務' },
  { step: 6, label: '行前任務' },
  { step: 7, label: '機動任務' },
  { step: 8, label: '任務檢視' },
];

export type MaintenanceTaskBasicDraft = {
  name: string;
  version: string;
  remarks: string;
};

export type MaintenanceFacilityEquipmentRow = {
  id: string;
  mapCode: string;
  /** 空字串表示無途經點 */
  waypointCode: string;
};

export type ChargingEquipmentRow = MaintenanceFacilityEquipmentRow & {
  chargeRateKwhPerMin: string;
};

export type CarWashEquipmentRow = MaintenanceFacilityEquipmentRow;

export type MaintenanceTaskChargingDraft = {
  stepEnabled: boolean;
  triggerPercent: string;
  triggerDetectionEnabled: boolean;
  upperLimitPercent: string;
  upperLimitDetectionEnabled: boolean;
  equipmentRows: ChargingEquipmentRow[];
};

export type MaintenanceTaskCarWashDraft = {
  stepEnabled: boolean;
  mileageTriggerKm: string;
  mileageDetectionEnabled: boolean;
  timeTriggerHours: string;
  timeDetectionEnabled: boolean;
  operationDurationMinutes: string;
  equipmentRows: CarWashEquipmentRow[];
};

export type MaintenanceCycleUnit = 'mileage' | 'time';

export type MaintenanceCycleConditionRow = {
  id: string;
  unit: MaintenanceCycleUnit;
  rangeMin: string;
  rangeMax: string;
  eventContent: string;
  durationMinutes: string;
};

/** 設施代號：場域 M* 代碼，或 unspecified（不指定） */
export const MAINTENANCE_STATION_UNSPECIFIED = 'unspecified';

export type MaintenanceTaskMaintenanceDraft = {
  stepEnabled: boolean;
  equipmentRows: MaintenanceFacilityEquipmentRow[];
  cycleConditions: MaintenanceCycleConditionRow[];
};

export type StationDurationTaskDraft = {
  stepEnabled: boolean;
  equipmentRows: MaintenanceFacilityEquipmentRow[];
  operationDurationMinutes: string;
  durationFollowTemplate?: boolean;
};

export type MaintenanceTaskPreTripDraft = StationDurationTaskDraft;

export type MaintenanceTaskMobileDraft = StationDurationTaskDraft;

/**
 * 調度任務：只負責<strong>載入調度設施</strong>，沒有觸發條件也沒有作業時長。
 *
 * 用途是「車暫時不能跑正線，先找個地方停一下」——
 * 由調度入廠卡（PI）開進來、調度出廠卡（PO）開回首站。
 * 停多久由排班決定（看什麼時候有班次可接），不是這裡設定的固定值，
 * 所以沒有 operationDurationMinutes。
 */
export type MaintenanceTaskParkingDraft = {
  stepEnabled: boolean;
  equipmentRows: MaintenanceFacilityEquipmentRow[];
};

/** 設施代號：不指定 */
export const PRE_TRIP_STATION_UNSPECIFIED = MAINTENANCE_STATION_UNSPECIFIED;
export const MOBILE_STATION_UNSPECIFIED = MAINTENANCE_STATION_UNSPECIFIED;

export function formatMaintenanceStationCode(code: string | null | undefined): string {
  if (!code || code === MAINTENANCE_STATION_UNSPECIFIED) return '不指定';
  return code;
}

/** DB 儲存用；標題可重複（預設名稱），自訂班表名稱需唯一 */
export const MAINTENANCE_TASK_UNTITLED_NAME = '未完成的整備任務';

export function resolveMaintenanceTaskDraftName(name: string): string {
  const trimmed = name.trim();
  return trimmed || MAINTENANCE_TASK_UNTITLED_NAME;
}

export function displayMaintenanceTaskDraftName(storedName: string): string {
  const trimmed = storedName.trim();
  if (!trimmed || trimmed === MAINTENANCE_TASK_UNTITLED_NAME) return '';
  return trimmed;
}

export function newFacilityEquipmentRowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newChargingEquipmentRowId(): string {
  return newFacilityEquipmentRowId('chg-row');
}

export function newCarWashEquipmentRowId(): string {
  return newFacilityEquipmentRowId('wash-row');
}

export function newMaintenanceFacilityEquipmentRowId(): string {
  return newFacilityEquipmentRowId('maint-fac');
}

export function newStationDurationEquipmentRowId(): string {
  return newFacilityEquipmentRowId('station-fac');
}

export function isFacilityEquipmentRowReady(
  row: MaintenanceFacilityEquipmentRow,
): boolean {
  return row.mapCode.trim().length > 0;
}

export function formatEquipmentWaypointLabel(waypointCode: string): string {
  const code = waypointCode.trim();
  return code || '無途經點';
}

export function formatEquipmentRowPreviewLine(
  row: MaintenanceFacilityEquipmentRow,
  suffix?: string,
): string {
  const waypoint = formatEquipmentWaypointLabel(row.waypointCode);
  const base =
    waypoint === '無途經點'
      ? `設施 ${row.mapCode}`
      : `設施 ${row.mapCode}；途經點 ${waypoint}`;
  return suffix ? `${base}；${suffix}` : base;
}

export function newMaintenanceCycleConditionRowId(): string {
  return `maint-cycle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type MaintenanceTaskCreateDraft = {
  basic: MaintenanceTaskBasicDraft;
  charging: MaintenanceTaskChargingDraft;
  carWash: MaintenanceTaskCarWashDraft;
  maintenance: MaintenanceTaskMaintenanceDraft;
  parking: MaintenanceTaskParkingDraft;
  preTrip: MaintenanceTaskPreTripDraft;
  mobile: MaintenanceTaskMobileDraft;
  currentStep: CreateMaintenanceTaskStep;
  maxReachedStep: CreateMaintenanceTaskStep;
};

export function emptyMaintenanceTaskChargingDraft(): MaintenanceTaskChargingDraft {
  return {
    stepEnabled: true,
    triggerPercent: '',
    triggerDetectionEnabled: true,
    upperLimitPercent: '100',
    upperLimitDetectionEnabled: true,
    equipmentRows: [],
  };
}

export function emptyMaintenanceTaskCarWashDraft(): MaintenanceTaskCarWashDraft {
  return {
    stepEnabled: true,
    mileageTriggerKm: '',
    mileageDetectionEnabled: true,
    timeTriggerHours: '',
    timeDetectionEnabled: true,
    operationDurationMinutes: '',
    equipmentRows: [],
  };
}

export function emptyMaintenanceTaskMaintenanceDraft(): MaintenanceTaskMaintenanceDraft {
  return {
    stepEnabled: true,
    equipmentRows: [],
    cycleConditions: [],
  };
}

export function emptyMaintenanceTaskPreTripDraft(): MaintenanceTaskPreTripDraft {
  return emptyStationDurationTaskDraft();
}

export function emptyMaintenanceTaskMobileDraft(): MaintenanceTaskMobileDraft {
  return emptyStationDurationTaskDraft();
}

export function emptyMaintenanceTaskParkingDraft(): MaintenanceTaskParkingDraft {
  return { stepEnabled: true, equipmentRows: [] };
}

export function emptyStationDurationTaskDraft(): StationDurationTaskDraft {
  return {
    stepEnabled: true,
    equipmentRows: [],
    operationDurationMinutes: '',
    durationFollowTemplate: true,
  };
}

export function normalizeCycleConditionRow(
  row: Partial<MaintenanceCycleConditionRow> & { id: string },
  fallbackUnit: MaintenanceCycleUnit = 'mileage',
): MaintenanceCycleConditionRow {
  const unit =
    row.unit === 'time' ? 'time' : row.unit === 'mileage' ? 'mileage' : fallbackUnit;
  return {
    id: row.id,
    unit,
    rangeMin: row.rangeMin ?? '',
    rangeMax: row.rangeMax ?? '',
    eventContent: row.eventContent ?? '',
    durationMinutes: row.durationMinutes ?? '',
  };
}

/** 缺欄位或 undefined 時，勾選狀態一律視為 true（僅明確 false 才取消勾選） */
export function normalizeChargingDraft(
  draft: Partial<MaintenanceTaskChargingDraft> & {
    triggerPercent?: string;
    upperLimitPercent?: string;
    equipmentRows?: ChargingEquipmentRow[];
  },
): MaintenanceTaskChargingDraft {
  const base = emptyMaintenanceTaskChargingDraft();
  return {
    ...base,
    ...draft,
    triggerPercent: draft.triggerPercent ?? base.triggerPercent,
    upperLimitPercent:
      draft.upperLimitPercent !== undefined && draft.upperLimitPercent !== ''
        ? draft.upperLimitPercent
        : base.upperLimitPercent,
    equipmentRows: draft.equipmentRows ?? base.equipmentRows,
    stepEnabled: draft.stepEnabled !== false,
    triggerDetectionEnabled: draft.triggerDetectionEnabled !== false,
    upperLimitDetectionEnabled: draft.upperLimitDetectionEnabled !== false,
  };
}

export function normalizeCarWashDraft(
  draft: Partial<MaintenanceTaskCarWashDraft> & {
    mileageTriggerKm?: string;
    timeTriggerHours?: string;
    operationDurationMinutes?: string;
    equipmentRows?: CarWashEquipmentRow[];
  },
): MaintenanceTaskCarWashDraft {
  const base = emptyMaintenanceTaskCarWashDraft();
  return {
    ...base,
    ...draft,
    mileageTriggerKm: draft.mileageTriggerKm ?? base.mileageTriggerKm,
    timeTriggerHours: draft.timeTriggerHours ?? base.timeTriggerHours,
    operationDurationMinutes: draft.operationDurationMinutes ?? base.operationDurationMinutes,
    equipmentRows: draft.equipmentRows ?? base.equipmentRows,
    stepEnabled: draft.stepEnabled !== false,
    mileageDetectionEnabled: draft.mileageDetectionEnabled !== false,
    timeDetectionEnabled: draft.timeDetectionEnabled !== false,
  };
}

export function normalizeMaintenanceDraft(
  draft: Partial<MaintenanceTaskMaintenanceDraft> & {
    stationCode?: string | null;
    cycleMode?: MaintenanceCycleUnit;
    cycleConditions?: MaintenanceCycleConditionRow[];
    equipmentRows?: MaintenanceFacilityEquipmentRow[];
  },
): MaintenanceTaskMaintenanceDraft {
  const base = emptyMaintenanceTaskMaintenanceDraft();
  const fallbackUnit = draft.cycleMode === 'time' ? 'time' : 'mileage';
  const equipmentRows = migrateEquipmentRowsFromLegacyStation(
    draft.equipmentRows,
    draft.stationCode,
    newMaintenanceFacilityEquipmentRowId,
  );
  return {
    ...base,
    ...draft,
    equipmentRows,
    cycleConditions: (draft.cycleConditions ?? base.cycleConditions).map((row) =>
      normalizeCycleConditionRow(row, fallbackUnit),
    ),
    stepEnabled: draft.stepEnabled !== false,
  };
}

export function normalizePreTripDraft(
  draft: Partial<MaintenanceTaskPreTripDraft> & {
    operationDurationMinutes?: string;
  },
): MaintenanceTaskPreTripDraft {
  return normalizeStationDurationDraft(draft);
}

export function normalizeMobileDraft(
  draft: Partial<MaintenanceTaskMobileDraft> & {
    operationDurationMinutes?: string;
  },
): MaintenanceTaskMobileDraft {
  return normalizeStationDurationDraft(draft);
}

export function normalizeStationDurationDraft(
  draft: Partial<StationDurationTaskDraft> & {
    stationCode?: string | null;
    operationDurationMinutes?: string;
    equipmentRows?: MaintenanceFacilityEquipmentRow[];
  },
): StationDurationTaskDraft {
  const base = emptyStationDurationTaskDraft();
  const equipmentRows = migrateEquipmentRowsFromLegacyStation(
    draft.equipmentRows,
    draft.stationCode,
    newStationDurationEquipmentRowId,
  );
  return {
    ...base,
    ...draft,
    equipmentRows,
    operationDurationMinutes: draft.operationDurationMinutes ?? base.operationDurationMinutes,
    stepEnabled: draft.stepEnabled !== false,
  };
}

export function emptyMaintenanceTaskCreateDraft(): MaintenanceTaskCreateDraft {
  return {
    basic: { name: '', version: '', remarks: '' },
    charging: emptyMaintenanceTaskChargingDraft(),
    carWash: emptyMaintenanceTaskCarWashDraft(),
    maintenance: emptyMaintenanceTaskMaintenanceDraft(),
    parking: emptyMaintenanceTaskParkingDraft(),
    preTrip: emptyMaintenanceTaskPreTripDraft(),
    mobile: emptyMaintenanceTaskMobileDraft(),
    currentStep: 1,
    maxReachedStep: 1,
  };
}

function parseWaypointCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseFacilityEquipmentRows(
  raw: unknown,
  newId: () => string,
): MaintenanceFacilityEquipmentRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MaintenanceFacilityEquipmentRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const mapCode = typeof row.mapCode === 'string' ? row.mapCode : '';
    const id =
      typeof row.id === 'string' && row.id.trim() ? row.id : newId();
    if (!mapCode && !parseWaypointCode(row.waypointCode)) continue;
    rows.push({
      id,
      mapCode,
      waypointCode: parseWaypointCode(row.waypointCode),
    });
  }
  return rows;
}

function migrateEquipmentRowsFromLegacyStation(
  equipmentRows: MaintenanceFacilityEquipmentRow[] | undefined,
  stationCode: string | null | undefined,
  newId: () => string,
): MaintenanceFacilityEquipmentRow[] {
  if (equipmentRows && equipmentRows.length > 0) {
    return equipmentRows.map((row) => ({
      ...row,
      waypointCode: row.waypointCode ?? '',
    }));
  }
  if (
    !stationCode
    || stationCode === MAINTENANCE_STATION_UNSPECIFIED
    || stationCode.trim() === ''
  ) {
    return [];
  }
  return [{ id: newId(), mapCode: stationCode, waypointCode: '' }];
}

function parseEquipmentRows(raw: unknown): ChargingEquipmentRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ChargingEquipmentRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const mapCode = typeof row.mapCode === 'string' ? row.mapCode : '';
    const chargeRateKwhPerMin =
      typeof row.chargeRateKwhPerMin === 'string' ? row.chargeRateKwhPerMin : '';
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id
        : newChargingEquipmentRowId();
    if (!mapCode && !chargeRateKwhPerMin && !parseWaypointCode(row.waypointCode)) {
      continue;
    }
    rows.push({
      id,
      mapCode,
      chargeRateKwhPerMin,
      waypointCode: parseWaypointCode(row.waypointCode),
    });
  }
  return rows;
}

function parseChargingDraft(body: Record<string, unknown>): MaintenanceTaskChargingDraft {
  const charging =
    body.charging && typeof body.charging === 'object'
      ? (body.charging as Record<string, unknown>)
      : null;

  if (!charging) return emptyMaintenanceTaskChargingDraft();

  return normalizeChargingDraft({
    stepEnabled:
      typeof charging.stepEnabled === 'boolean' ? charging.stepEnabled : undefined,
    triggerPercent:
      typeof charging.triggerPercent === 'string' ? charging.triggerPercent : '',
    triggerDetectionEnabled:
      typeof charging.triggerDetectionEnabled === 'boolean'
        ? charging.triggerDetectionEnabled
        : undefined,
    upperLimitPercent:
      typeof charging.upperLimitPercent === 'string' ? charging.upperLimitPercent : '',
    upperLimitDetectionEnabled:
      typeof charging.upperLimitDetectionEnabled === 'boolean'
        ? charging.upperLimitDetectionEnabled
        : undefined,
    equipmentRows: parseEquipmentRows(charging.equipmentRows),
  });
}

function parseCarWashEquipmentRows(raw: unknown): CarWashEquipmentRow[] {
  return parseFacilityEquipmentRows(raw, newCarWashEquipmentRowId);
}

function parseCarWashDraft(body: Record<string, unknown>): MaintenanceTaskCarWashDraft {
  const carWash =
    body.carWash && typeof body.carWash === 'object'
      ? (body.carWash as Record<string, unknown>)
      : null;

  if (!carWash) return emptyMaintenanceTaskCarWashDraft();

  return normalizeCarWashDraft({
    stepEnabled: typeof carWash.stepEnabled === 'boolean' ? carWash.stepEnabled : undefined,
    mileageTriggerKm:
      typeof carWash.mileageTriggerKm === 'string' ? carWash.mileageTriggerKm : '',
    mileageDetectionEnabled:
      typeof carWash.mileageDetectionEnabled === 'boolean'
        ? carWash.mileageDetectionEnabled
        : undefined,
    timeTriggerHours:
      typeof carWash.timeTriggerHours === 'string' ? carWash.timeTriggerHours : '',
    timeDetectionEnabled:
      typeof carWash.timeDetectionEnabled === 'boolean' ? carWash.timeDetectionEnabled : undefined,
    operationDurationMinutes:
      typeof carWash.operationDurationMinutes === 'string'
        ? carWash.operationDurationMinutes
        : '',
    equipmentRows: parseCarWashEquipmentRows(carWash.equipmentRows),
  });
}

function parseMaintenanceCycleConditions(
  raw: unknown,
  fallbackUnit: MaintenanceCycleUnit = 'mileage',
): MaintenanceCycleConditionRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MaintenanceCycleConditionRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id
        : newMaintenanceCycleConditionRowId();
    rows.push(
      normalizeCycleConditionRow(
        {
          id,
          unit:
            row.unit === 'time' || row.unit === 'mileage'
              ? (row.unit as MaintenanceCycleUnit)
              : undefined,
          rangeMin: typeof row.rangeMin === 'string' ? row.rangeMin : '',
          rangeMax: typeof row.rangeMax === 'string' ? row.rangeMax : '',
          eventContent: typeof row.eventContent === 'string' ? row.eventContent : '',
          durationMinutes: typeof row.durationMinutes === 'string' ? row.durationMinutes : '',
        },
        fallbackUnit,
      ),
    );
  }
  return rows;
}

function parseMaintenanceDraft(body: Record<string, unknown>): MaintenanceTaskMaintenanceDraft {
  const maintenance =
    body.maintenance && typeof body.maintenance === 'object'
      ? (body.maintenance as Record<string, unknown>)
      : null;

  if (!maintenance) return emptyMaintenanceTaskMaintenanceDraft();

  const stationRaw = maintenance.stationCode;
  const fallbackUnit = maintenance.cycleMode === 'time' ? 'time' : 'mileage';

  return normalizeMaintenanceDraft({
    stepEnabled:
      typeof maintenance.stepEnabled === 'boolean' ? maintenance.stepEnabled : undefined,
    stationCode:
      stationRaw === null || stationRaw === undefined
        ? null
        : typeof stationRaw === 'string'
          ? stationRaw
          : null,
    equipmentRows: parseFacilityEquipmentRows(
      maintenance.equipmentRows,
      newMaintenanceFacilityEquipmentRowId,
    ),
    cycleMode: fallbackUnit,
    cycleConditions: parseMaintenanceCycleConditions(maintenance.cycleConditions, fallbackUnit),
  });
}

function parseStationDurationDraft(
  body: Record<string, unknown>,
  key: 'preTrip' | 'mobile',
  empty: () => StationDurationTaskDraft,
): StationDurationTaskDraft {
  const section =
    body[key] && typeof body[key] === 'object'
      ? (body[key] as Record<string, unknown>)
      : null;

  if (!section) return empty();

  const stationRaw = section.stationCode;
  const stationCode =
    stationRaw === null || stationRaw === undefined
      ? null
      : typeof stationRaw === 'string'
        ? stationRaw
        : null;

  return normalizeStationDurationDraft({
    stepEnabled: typeof section.stepEnabled === 'boolean' ? section.stepEnabled : undefined,
    stationCode,
    equipmentRows: parseFacilityEquipmentRows(
      section.equipmentRows,
      newStationDurationEquipmentRowId,
    ),
    operationDurationMinutes:
      typeof section.operationDurationMinutes === 'string'
        ? section.operationDurationMinutes
        : '',
  });
}

function parseParkingDraft(body: Record<string, unknown>): MaintenanceTaskParkingDraft {
  const section =
    body.parking && typeof body.parking === 'object'
      ? (body.parking as Record<string, unknown>)
      : null;
  if (!section) return emptyMaintenanceTaskParkingDraft();
  return {
    stepEnabled:
      typeof section.stepEnabled === 'boolean' ? section.stepEnabled : true,
    equipmentRows: parseFacilityEquipmentRows(
      section.equipmentRows,
      newStationDurationEquipmentRowId,
    ),
  };
}

function parsePreTripDraft(body: Record<string, unknown>): MaintenanceTaskPreTripDraft {
  return parseStationDurationDraft(body, 'preTrip', emptyMaintenanceTaskPreTripDraft);
}

function parseMobileDraft(body: Record<string, unknown>): MaintenanceTaskMobileDraft {
  return parseStationDurationDraft(body, 'mobile', emptyMaintenanceTaskMobileDraft);
}

export function serializeMaintenanceTaskBody(
  draft: MaintenanceTaskCreateDraft,
): Record<string, unknown> {
  return {
    editorVersion: 1,
    version: draft.basic.version,
    remarks: draft.basic.remarks,
    currentStep: draft.currentStep,
    maxReachedStep: draft.maxReachedStep,
    charging: {
      stepEnabled: draft.charging.stepEnabled,
      triggerPercent: draft.charging.triggerPercent,
      triggerDetectionEnabled: draft.charging.triggerDetectionEnabled,
      upperLimitPercent: draft.charging.upperLimitPercent,
      upperLimitDetectionEnabled: draft.charging.upperLimitDetectionEnabled,
      equipmentRows: draft.charging.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        chargeRateKwhPerMin: row.chargeRateKwhPerMin,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
    },
    carWash: {
      stepEnabled: draft.carWash.stepEnabled,
      mileageTriggerKm: draft.carWash.mileageTriggerKm,
      mileageDetectionEnabled: draft.carWash.mileageDetectionEnabled,
      timeTriggerHours: draft.carWash.timeTriggerHours,
      timeDetectionEnabled: draft.carWash.timeDetectionEnabled,
      operationDurationMinutes: draft.carWash.operationDurationMinutes,
      equipmentRows: draft.carWash.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
    },
    maintenance: {
      stepEnabled: draft.maintenance.stepEnabled,
      equipmentRows: draft.maintenance.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
      cycleConditions: draft.maintenance.cycleConditions.map((row) => ({
        id: row.id,
        unit: row.unit,
        rangeMin: row.rangeMin,
        rangeMax: row.rangeMax,
        eventContent: row.eventContent,
        durationMinutes: row.durationMinutes,
      })),
    },
    parking: {
      stepEnabled: draft.parking.stepEnabled,
      equipmentRows: draft.parking.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
    },
    preTrip: {
      stepEnabled: draft.preTrip.stepEnabled,
      equipmentRows: draft.preTrip.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
      operationDurationMinutes: draft.preTrip.operationDurationMinutes,
    },
    mobile: {
      stepEnabled: draft.mobile.stepEnabled,
      equipmentRows: draft.mobile.equipmentRows.map((row) => ({
        id: row.id,
        mapCode: row.mapCode,
        ...(row.waypointCode ? { waypointCode: row.waypointCode } : {}),
      })),
      operationDurationMinutes: draft.mobile.operationDurationMinutes,
    },
  };
}

export function buildMaintenanceTaskDraftFromStored(
  name: string,
  body: Record<string, unknown>,
): MaintenanceTaskCreateDraft {
  const currentStep =
    typeof body.currentStep === 'number' && body.currentStep >= 1 && body.currentStep <= 8
      ? (body.currentStep as CreateMaintenanceTaskStep)
      : 1;

  const maxReachedStepRaw =
    typeof body.maxReachedStep === 'number' ? body.maxReachedStep : currentStep;
  const maxReachedStep = Math.max(
    currentStep,
    Math.min(8, Math.max(1, maxReachedStepRaw)),
  ) as CreateMaintenanceTaskStep;

  return {
    basic: {
      name: displayMaintenanceTaskDraftName(name),
      version: typeof body.version === 'string' ? body.version : '',
      remarks: typeof body.remarks === 'string' ? body.remarks : '',
    },
    charging: parseChargingDraft(body),
    carWash: parseCarWashDraft(body),
    maintenance: parseMaintenanceDraft(body),
    parking: parseParkingDraft(body),
    preTrip: parsePreTripDraft(body),
    mobile: parseMobileDraft(body),
    currentStep,
    maxReachedStep,
  };
}

export function isChargingStepComplete(charging: MaintenanceTaskChargingDraft): boolean {
  const normalized = normalizeChargingDraft(charging);
  if (!normalized.stepEnabled) return true;

  if (!isPositiveIntegerBelow(normalized.triggerPercent, 100)) {
    return false;
  }

  if (
    normalized.upperLimitDetectionEnabled &&
    !isPositiveIntegerUpTo(normalized.upperLimitPercent, 100)
  ) {
    return false;
  }

  if (normalized.equipmentRows.length === 0) return false;

  for (const row of normalized.equipmentRows) {
    if (!isFacilityEquipmentRowReady(row)) return false;
    if (!isPositiveInteger(row.chargeRateKwhPerMin)) return false;
  }

  return true;
}

export function isCarWashStepComplete(carWash: MaintenanceTaskCarWashDraft): boolean {
  const normalized = normalizeCarWashDraft(carWash);
  if (!normalized.stepEnabled) return true;

  if (normalized.mileageDetectionEnabled && !isPositiveInteger(normalized.mileageTriggerKm)) {
    return false;
  }
  if (normalized.timeDetectionEnabled && !isPositiveInteger(normalized.timeTriggerHours)) {
    return false;
  }
  if (!isPositiveInteger(normalized.operationDurationMinutes)) return false;

  if (normalized.equipmentRows.length === 0) return false;

  for (const row of normalized.equipmentRows) {
    if (!isFacilityEquipmentRowReady(row)) return false;
  }

  return true;
}

function isValidCycleConditionRow(row: MaintenanceCycleConditionRow): boolean {
  const min = row.rangeMin.trim();
  const max = row.rangeMax.trim();
  const event = row.eventContent.trim();
  const duration = row.durationMinutes.trim();
  if (!isPositiveInteger(min) || !isPositiveInteger(max)) return false;
  if (Number(min) > Number(max)) return false;
  if (!event) return false;
  if (!isPositiveInteger(duration)) return false;
  return true;
}

export function isMaintenanceStepComplete(
  maintenance: MaintenanceTaskMaintenanceDraft,
): boolean {
  const normalized = normalizeMaintenanceDraft(maintenance);
  if (!normalized.stepEnabled) return true;

  if (normalized.equipmentRows.length === 0) return false;
  if (normalized.cycleConditions.length === 0) return false;

  for (const row of normalized.equipmentRows) {
    if (!isFacilityEquipmentRowReady(row)) return false;
  }

  for (const row of normalized.cycleConditions) {
    if (!isValidCycleConditionRow(row)) return false;
  }

  return true;
}

export function isPreTripStepComplete(preTrip: MaintenanceTaskPreTripDraft): boolean {
  return isStationDurationStepComplete(preTrip);
}

export function isMobileStepComplete(mobile: MaintenanceTaskMobileDraft): boolean {
  return isStationDurationStepComplete(mobile);
}

export function isStationDurationStepComplete(task: StationDurationTaskDraft): boolean {
  const normalized = normalizeStationDurationDraft(task);
  if (!normalized.stepEnabled) return true;

  if (normalized.equipmentRows.length === 0) return false;
  if (!isPositiveInteger(normalized.operationDurationMinutes)) return false;

  for (const row of normalized.equipmentRows) {
    if (!isFacilityEquipmentRowReady(row)) return false;
  }

  return true;
}

export function isCreateMaintenanceTaskStepComplete(
  step: CreateMaintenanceTaskStep,
  draft: MaintenanceTaskCreateDraft,
  options?: { nameUniqueOk?: boolean },
): boolean {
  if (step === 1) {
    const hasRequired =
      draft.basic.name.trim().length > 0 && draft.basic.version.trim().length > 0;
    if (!hasRequired) return false;
    if (options?.nameUniqueOk === false) return false;
    return true;
  }
  if (step === 2) return isChargingStepComplete(draft.charging);
  if (step === 3) return isCarWashStepComplete(draft.carWash);
  if (step === 4) return isMaintenanceStepComplete(draft.maintenance);
  if (step === 5) return isPreTripStepComplete(draft.preTrip);
  if (step === 6) return isMobileStepComplete(draft.mobile);
  return true;
}

export function formatMaintenanceCycleCondition(row: MaintenanceCycleConditionRow): string {
  const prefix = row.unit === 'mileage' ? '當車輛行程每滿' : '當車輛時間每滿';
  const unit = row.unit === 'mileage' ? '公里' : '小時';
  return `${prefix} ${row.rangeMin} - ${row.rangeMax} ${unit}，觸發 ${row.eventContent}，預估 ${row.durationMinutes} 分`;
}
