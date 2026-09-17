import type { VariableMap } from '../VariableContext';
import { formatMqttDisplayScalar } from './mqttFieldResolve';
import { resolveT3TrackCode } from '../../map-editor/vehicles/t3FieldTrackClassifier';

/** 停靠點／站名（非軌道段、非設施格） */
const DOCKING_STATION_NAME_RE = /^(N2W|S2W|T3)(上行|下行)?$/i;

/**
 * 軌道段 D03 / U02 或設施格 E1、P1、H1…
 *
 * D 後面收一到兩位數：場區格位就叫 D1 到 D5，只收兩位數的話這些車的位置一律變成「—」。
 */
const TRACK_OR_FACILITY_RE = /^([DU]\d{1,2}|E\d+|P[1-4]|H\d+|M\d+|W\d+)$/i;

const MAINLINE_TRIP_RE = /^[DU][0-9]{4}$/i;

/**
 * 正線區段簡碼：N2W、T3上、S2W下 這種。
 *
 * 位置這一欄本來只收軌道段（D18）與格位（M1），因為那時候正線車的段號是 SQL 拿車號
 * 算出來的假值（D20、U08）——不收是對的。現在那段假值拿掉了，車端協議也不報段號，
 * 唯一說得出口的位置是「正往哪一站」，由 SQL 從班表的站序壓成簡碼。
 *
 * 真的要顯示 D18 這種段號，得拿車輛座標去比對圖資的里程對應，那是圖台在做的事，
 * 不在這張卡的資料來源裡。
 */
const MAINLINE_SEGMENT_SHORTHAND_RE = /^(N2W|S2W|T3)(上|下)?$/;

function isMaintenanceLocationContext(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  const opLine = String(sources.operation?.line_kind ?? '').toUpperCase();
  if (opLine === 'MAINTENANCE') return true;
  if (sources.operation?.maint_type_label) return true;
  if (sources.operation?.yard_slot_id != null && sources.operation?.yard_slot_id !== '') return true;

  const varLine = String(sources.variables?.line_kind ?? '').toUpperCase();
  if (varLine === 'MAINTENANCE') return true;
  if (String(sources.variables?.badge_kind ?? '').toLowerCase() === 'maintenance') return true;
  if (sources.variables?.maint_type_label) return true;
  return false;
}

function isMainlineLocationContext(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  if (isMaintenanceLocationContext(sources)) return false;

  const lineKind = String(
    sources.operation?.line_kind ?? sources.variables?.line_kind ?? '',
  ).toUpperCase();
  if (lineKind === 'MAINLINE') return true;
  const trip = String(sources.operation?.trip_code ?? sources.variables?.trip_code ?? '').trim();
  return MAINLINE_TRIP_RE.test(trip);
}

function isMainlineAwaitingDeparture(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  const orderStatus = String(
    sources.operation?.order_status ?? sources.variables?.order_status ?? '',
  ).toUpperCase();
  const phase = String(sources.operation?.vehicle_phase ?? '').toUpperCase();
  return orderStatus === 'PENDING' || phase === 'AWAITING_DEPARTURE';
}

/*
 * 原本這裡會把 D3 補成 D03，因為舊的軌道段標籤有時候少一位。現在補零反而會把格位
 * D3 寫成軌道段 D03——那是兩個不同的地方。原樣保留，只統一大小寫。
 */
function normalizeTrackOrFacilityCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 只接受軌道段或設施格代碼；拒絕 N2W下行、T3 等停靠點名稱 */
export function sanitizeTrackOrFacilityLabel(raw: unknown): string | undefined {
  const scalar = formatMqttDisplayScalar(raw);
  if (!scalar) return undefined;
  if (DOCKING_STATION_NAME_RE.test(scalar)) return undefined;
  if (/上行|下行|車站/.test(scalar)) return undefined;
  if (scalar.includes('→')) {
    for (const part of scalar.split('→')) {
      const parsed = sanitizeTrackOrFacilityLabel(part.trim());
      if (parsed) return parsed;
    }
    return undefined;
  }
  if (TRACK_OR_FACILITY_RE.test(scalar)) {
    return normalizeTrackOrFacilityCode(scalar);
  }
  return undefined;
}

/**
 * 車子回報的座標落在哪一段軌道。
 *
 * 協議裡沒有「現在在哪一段」這個欄位，車端報的是 local_pose.position（場域公尺），
 * 段號是中心端自己依座標分的——圖台上的車就是這樣定位的，這裡用同一支分類器，
 * 卡片與圖台才會說同一件事。
 */
function trackCodeFromTelemetryPose(
  telemetry: Record<string, unknown> | null | undefined,
): string | undefined {
  const pose = telemetry?.local_pose;
  if (!pose || typeof pose !== 'object') return undefined;
  const position = (pose as { position?: unknown }).position;
  if (!position || typeof position !== 'object') return undefined;
  const { x, y } = position as { x?: unknown; y?: unknown };
  const xM = Number(x);
  const yM = Number(y);
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) return undefined;
  return resolveT3TrackCode(xM, yM) ?? undefined;
}

/** 車輛卡位置：yard_slot_id（設施）或 segment_label（軌道段）；不含停靠點站名 */
export function resolveVehicleLocationLabel(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
  telemetry?: Record<string, unknown> | null;
}): string {
  const yardFromOperation = sanitizeTrackOrFacilityLabel(
    sources.operation?.yard_slot_id
    ?? (sources.operation && 'value' in sources.operation ? sources.operation.value : undefined),
  );
  if (yardFromOperation) return yardFromOperation;

  if (isMaintenanceLocationContext(sources)) {
    const yard = sanitizeTrackOrFacilityLabel(
      sources.variables?.yard_slot_id
      ?? sources.variables?.segment_label,
    );
    if (yard) return yard;
    return '—';
  }

  if (isMainlineLocationContext(sources)) {
    if (isMainlineAwaitingDeparture(sources)) {
      const yard = sanitizeTrackOrFacilityLabel(
        sources.operation?.yard_slot_id
        ?? sources.variables?.yard_slot_id
        ?? sources.variables?.segment_label,
      );
      if (yard) return yard;
    }
    const fromPose = trackCodeFromTelemetryPose(sources.telemetry);
    if (fromPose) return fromPose;
    const track = sanitizeTrackOrFacilityLabel(
      sources.telemetry?.segment_label
      ?? sources.variables?.segment_label,
    );
    if (track) return track;
    const shorthand = String(sources.variables?.segment_label ?? '').trim();
    if (MAINLINE_SEGMENT_SHORTHAND_RE.test(shorthand)) return shorthand;
    return '—';
  }

  const yard = sanitizeTrackOrFacilityLabel(
    sources.operation?.yard_slot_id
    ?? sources.variables?.yard_slot_id,
  );
  if (yard) return yard;

  const fromPose = trackCodeFromTelemetryPose(sources.telemetry);
  if (fromPose) return fromPose;

  const track = sanitizeTrackOrFacilityLabel(
    sources.telemetry?.segment_label
    ?? sources.variables?.segment_label,
  );
  if (track) return track;

  // 沒有任何任務在身上時 SQL 直接寫「待命」，那也是一種位置說明，照它顯示。
  const idle = String(sources.variables?.segment_label ?? '').trim();
  if (idle === '待命') return idle;

  return '—';
}
