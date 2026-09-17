import type { MapAreaObject } from '../types/area';
import type { FacilityObject } from '../types/facility';
import { isMeterInDomain, meterToAreaLocalPx } from '../utils/areaCoords';
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from '../utils/facilityAreaCoords';
import {
  getValidRefFieldBounds,
  hasValidRefFieldBounds,
  refFieldBoundsSpanMeters,
} from '../utils/facilityRefFieldBounds';
import {
  absoluteToZoneLocal,
  isZonePartition,
} from '../utils/zonePartition';
import {
  isYardParkableFacilityId,
  parseYardSlotFromPayload,
  resolveYardFacilityFieldMeters,
} from '../utils/yardFacilitySlots';
import {
  buildTrackNetwork,
  getTrackNetwork,
} from './trackNetwork/scanMap';
import type { TrackNetwork } from './trackNetwork/types';
import type { PathXY } from '../utils/trackGenPaths';
import type { TrackGenLatMode } from '../utils/trackGenPaths';
import {
  getTrackGenLatMode,
  getTrackGenLatPerBox,
  getTrackGenPaths,
  pointAlongPath,
  projectAlongPath,
  tangentAlongPath,
  trackGenPickScore,
} from '../utils/trackGenPaths';
import { locateOnCrossover } from './trackNetwork/crossoverLocate';
import { locateOnTrackNetwork, trackCodeAtFieldPoint } from './trackNetwork/locate';

/**
 * 這一點在路網上的位置：road、lane、沿參考線的里程，以及離該段中心線多遠。
 */
export type VehicleNetworkFix = {
  roadId: string;
  laneId: number;
  /** 沿該 road 參考線的里程（公尺） */
  sM: number;
  /** 離該段真實中心線多遠（公尺），可用來判斷是不是根本不在軌道上 */
  offsetM: number;
  /**
   * 落在這一塊中心線的幾成（0–1）。
   *
   * 挑塊的時候就已經投影算過了，帶出來給格化用——不帶的話下游得再投影一次，
   * 兩次的結果在邊界附近會不一致（實測同一個點，挑塊算 0.75、重算 0.7499，差一格）。
   */
  alongFrac: number;
};

export type VehicleTrackPlacement = {
  areaLocalX: number;
  areaLocalY: number;
  trackId: string;
  /** @deprecated 巢狀定位不再使用分數；保留欄位相容舊型別 */
  score: number;
  /** 反查到的路網位置；手工軌道或查不到時沒有這一欄 */
  network?: VehicleNetworkFix;
};

export type VehiclePlacementAcrossAreas = {
  area: MapAreaObject;
  placement: VehicleTrackPlacement;
};

/** MQTT 整備／充電／臨停：應顯示在格位區，不吸附主軌道 */
export function isYardVehiclePayload(
  payload: Record<string, unknown> | undefined,
): boolean {
  if (!payload) return false;
  const yardSlot = payload.yard_slot_id ?? payload.yardSlotId;
  if (typeof yardSlot === 'string' && yardSlot.trim()) return true;
  const leg = payload.current_leg;
  if (leg === 'yard') return true;
  const trip = payload.trip_code ?? payload.tripCode;
  if (trip === 'YARD') return true;
  const segment = payload.segment_label;
  if (typeof segment === 'string') {
    const label = segment.trim();
    /*
     * 這裡也曾經漏掉調度區的 D。清單式的比對每加一個分區就要回來補一次，補漏了
     * 也不會報錯——只是那一區的車不被當成場區車，定位鏈直接走空。改用同一支形狀
     * 判定，實際是不是停車格由圖資認定（見 isYardParkableFacilityId）。
     */
    if (isYardParkableFacilityId(label)) return true;
    return (
      label.startsWith('充電 ') ||
      label.startsWith('充電等候 ') ||
      label.startsWith('臨停 ') ||
      label.startsWith('整備 ')
    );
  }
  return false;
}

/**
 * 落在分區裡的車：照分區的場域範圍反算圖面位置。
 *
 * <h3>為什麼需要這一步</h3>
 * 場區（整備、調度、充電）底下沒有軌道，所以軌道那條路查不到。車停著時靠 telemetry
 * 帶的 yard_slot_id 對到格位，但<strong>正在開進去的時候不帶那個欄位</strong>——車還
 * 沒停好，說不出自己在哪一格。於是那幾秒鐘定位失敗，圖台只能沿用上一幀，車看起來卡
 * 在別的地方不動（實測一台進整備區的車被畫在八百公尺外的正線旁邊）。
 *
 * 分區本來就記著「這塊圖面＝現場哪一塊」，把那個對應反過來用就是了。
 */
function locateInZonePartition(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  for (const area of areas) {
    for (const zone of area.facilities) {
      if (!isZonePartition(zone)) continue;
      const bounds = getValidRefFieldBounds(zone.parameters);
      if (!bounds) continue;
      if (!fieldPointInRefField(xM, yM, bounds)) continue;
      const local = absoluteToZoneLocal(xM, yM, bounds);
      const pos = resolveFacilityAreaPosition(zone, area.domain, area.layout);
      const size = resolveFacilityAreaSize(zone, area.domain, area.layout);
      return {
        area,
        placement: {
          areaLocalX: pos.x + local.u * size.w,
          areaLocalY: pos.y + local.v * size.h,
          trackId: zone.id,
          score: 1,
        },
      };
    }
  }
  return null;
}

function locateInAreaDomain(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  for (const area of areas) {
    if (!isMeterInDomain(xM, yM, area.domain)) continue;
    const local = meterToAreaLocalPx(xM, yM, area.domain, area.layout);
    return {
      area,
      placement: {
        areaLocalX: local.x,
        areaLocalY: local.y,
        trackId: 'yard',
        score: 1,
      },
    };
  }
  return null;
}

/** 從 MQTT 解析整備格代號（充電 E1、臨停 P1、整備 H1） */
export function parseYardSlotIdFromPayload(
  payload: Record<string, unknown> | undefined,
): string | null {
  return parseYardSlotFromPayload(payload)?.slotId ?? null;
}

function placementAtFieldMeters(
  facility: FacilityObject,
  area: MapAreaObject,
  xM: number,
  yM: number,
): VehiclePlacementAcrossAreas | null {
  if (facility.type === 'Track') {
    const local = fieldPositionToTrackAreaLocal(xM, yM, facility, area, {
      extrapolate: false,
    });
    if (!local) return null;
    return {
      area,
      placement: {
        areaLocalX: local.x,
        areaLocalY: local.y,
        trackId: facility.id,
        score: 1,
      },
    };
  }

  const local = fieldPositionToFacilityAreaLocal(xM, yM, facility, area, {
    extrapolate: false,
  });
  if (!local) return null;
  return {
    area,
    placement: {
      areaLocalX: local.x,
      areaLocalY: local.y,
      trackId: facility.id,
      score: 1,
    },
  };
}

function placementAtFacilityAreaCenter(
  facility: FacilityObject,
  area: MapAreaObject,
): VehiclePlacementAcrossAreas {
  const areaPos = resolveFacilityAreaPosition(facility, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(facility, area.domain, area.layout);
  return {
    area,
    placement: {
      areaLocalX: areaPos.x + areaSize.w / 2,
      areaLocalY: areaPos.y + areaSize.h / 2,
      trackId: facility.id,
      score: 1,
    },
  };
}

/** 整備／充電／臨停：對齊地圖格子的場域座標或元件外框中心 */
export function resolveYardFacilityPlacement(
  areas: MapAreaObject[],
  payload: Record<string, unknown> | undefined,
): VehiclePlacementAcrossAreas | null {
  const yardSlot = parseYardSlotFromPayload(payload);
  if (!yardSlot || !isYardParkableFacilityId(yardSlot.slotId)) return null;

  const field = resolveYardFacilityFieldMeters(yardSlot.slotId, areas, {
    subIndex: yardSlot.subIndex,
  });
  if (!field) return null;

  const refFieldPlacement = placementAtFieldMeters(
    field.facility,
    field.area,
    field.xM,
    field.yM,
  );
  if (refFieldPlacement) return refFieldPlacement;
  return placementAtFacilityAreaCenter(field.facility, field.area);
}

function normalizeSegmentToken(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const arrow = trimmed.split('→').pop()?.trim();
  return arrow || trimmed;
}

function fieldPointInRefField(
  xM: number,
  yM: number,
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): boolean {
  return (
    xM >= bounds.xMinM &&
    xM <= bounds.xMaxM &&
    yM >= bounds.yMinM &&
    yM <= bounds.yMaxM
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function readRotationDeg(track: FacilityObject): number {
  const deg = track.rotation ?? 0;
  return Number.isFinite(deg) ? deg : 0;
}

/** 依 MQTT segment_label 對應軌道元件（customName / segmentId） */
export function findTrackBySegmentLabel(
  area: MapAreaObject,
  segmentLabel: string | undefined,
): FacilityObject | null {
  if (!segmentLabel?.trim()) return null;
  const label = segmentLabel.trim();
  const token = normalizeSegmentToken(label);
  const tracks = (area.facilities ?? []).filter((f) => f.type === 'Track');

  for (const track of tracks) {
    if (track.customName === label || track.customName === token) return track;
    const segId = track.parameters?.segmentId;
    if (typeof segId === 'string' && (segId === label || segId === token)) return track;
  }

  const prefix = label.split('→')[0]?.trim();
  if (prefix) {
    for (const track of tracks) {
      if (track.customName === prefix) return track;
      const segId = track.parameters?.segmentId;
      if (typeof segId === 'string' && segId === prefix) return track;
    }
  }

  return null;
}

/**
 * 場域 (x,y) 公尺 → 設施元件在 Area 內的區域座標（依場域範圍參數化映射）。
 * extrapolate=false 時 along 箝制在 0–1（範圍外不應呼叫）。
 */
export function fieldPositionToFacilityAreaLocal(
  xM: number,
  yM: number,
  facility: FacilityObject,
  area: MapAreaObject,
  options?: { extrapolate?: boolean },
): { x: number; y: number } | null {
  if (!hasValidRefFieldBounds(facility.parameters)) return null;

  const bounds = getValidRefFieldBounds(facility.parameters);
  if (!bounds) return null;

  const span = refFieldBoundsSpanMeters(bounds);
  if (!span) return null;

  const areaPos = resolveFacilityAreaPosition(facility, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(facility, area.domain, area.layout);

  let alongX = (xM - bounds.xMinM) / span.w;
  let alongY = (yM - bounds.yMinM) / span.h;
  if (!options?.extrapolate) {
    alongX = clamp01(alongX);
    alongY = clamp01(alongY);
  }

  let localX = areaPos.x + alongX * areaSize.w;
  let localY = areaPos.y + alongY * areaSize.h;

  const rotDeg = readRotationDeg(facility);
  if (Math.abs(rotDeg) > 0.001) {
    const cx = areaPos.x + areaSize.w / 2;
    const cy = areaPos.y + areaSize.h / 2;
    const rad = (rotDeg * Math.PI) / 180;
    const dx = localX - cx;
    const dy = localY - cy;
    localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  return { x: localX, y: localY };
}

/**
 * 將 MQTT 場域座標（公尺）換算成圖台上該軌道段的區域座標。
 * extrapolate=false 時 along 箝制在 0–1（段外不應呼叫）。
 */
/**
 * 圖面中心線上的一點（未旋轉外框的 0–1 比例）換成 Area 內座標。
 *
 * 圖面路徑的 v 是「外框上緣為 0」，areaPosition 卻是左下原點、y 向上，所以要翻一次。
 * 少了這一次翻轉，轉角與相鄰直線段的接點差了整整一個外框高——實測 138 像素。
 */
export function trackLocalPathPointToAreaLocal(
  track: FacilityObject,
  area: MapAreaObject,
  uv: { x: number; y: number },
): { x: number; y: number } {
  const areaPos = resolveFacilityAreaPosition(track, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(track, area.domain, area.layout);
  return applyTrackRotation(
    areaPos.x + uv.x * areaSize.w,
    areaPos.y + (1 - uv.y) * areaSize.h,
    areaPos,
    areaSize,
    readRotationDeg(track),
  );
}

/**
 * 圖面路徑上的一點，<strong>再照偏移量往旁邊移出去</strong>。
 */
export function offsetLocalPoint(
  local: PathXY,
  along: number,
  sideM: number,
  latPerBox: [number, number] | null,
  mode: TrackGenLatMode,
): { x: number; y: number } {
  const uv = pointAlongPath(local, along);
  if (!latPerBox || Math.abs(sideM) < 1e-9) return uv;
  const d = tangentAlongPath(local, along);
  // 真實世界的左手邊，換到圖面座標系就是 (dy, −dx)
  const n = { x: d.y, y: -d.x };
  if (mode === 'arc') {
    return { x: uv.x + sideM * n.x * latPerBox[0], y: uv.y + sideM * n.y * latPerBox[1] };
  }
  /*
   * 並排的軌道是照外框的橫軸疊起來的，所以偏移量也要沿那一軸。
   *
   * 哪一軸是「橫」的，看這條圖面路徑整體往哪走——沿著外框長的那一軸走，橫的就是另一軸。
   */
  const a = local[0]!;
  const b = local[local.length - 1]!;
  const alongU = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  if (alongU) {
    return { x: uv.x, y: uv.y + Math.sign(n.y || 1) * sideM * latPerBox[1] };
  }
  return { x: uv.x + Math.sign(n.x || 1) * sideM * latPerBox[0], y: uv.y };
}

/**
 * 這台車在它所在那一塊上「<strong>畫出來</strong>」的行進方向。
 *
 * <h3>為什麼不能直接照 heading 轉圖示</h3>
 * heading 是現場的朝向，示意圖卻會把同一段路畫成別的方向：T3 支線在現場是南北向，
 * 圖上那幾塊卻是橫的帶子（元件本身轉了 90 度）；正線在現場微彎，圖上是一條直的。
 * 照 heading 轉，車頭就會跟它所在的那條帶子交叉——實測正線上的車被畫成直立的，
 * 橫跨整條帶子。
 *
 * 圖面方向與現場方向的對應，每一塊自己帶著（trackGenLocalPath 對 trackGenRealPath）。
 * 取車所在位置的圖面切線，再照現場切線決定車頭朝前還是朝後。
 *
 * 回傳的是<strong>區域座標</strong>的單位向量（y 向上）。沒有生成路徑的方塊回 null，
 * 呼叫端退回照 heading 轉。
 */
export function drawnDirectionAtField(
  track: FacilityObject,
  area: MapAreaObject,
  xM: number,
  yM: number,
  headingRad?: number,
): { x: number; y: number } | null {
  const paths = getTrackGenPaths(track.parameters);
  if (!paths) return null;
  const { along } = projectAlongPath(paths.real, xM, yM);
  const localTan = tangentAlongPath(paths.local, along);
  const size = resolveFacilityAreaSize(track, area.domain, area.layout);
  // 圖面切線的 y 向下，區域座標的 y 向上
  let dx = localTan.x * size.w;
  let dy = -localTan.y * size.h;
  const rot = readRotationDeg(track);
  if (Math.abs(rot) > 0.001) {
    const rad = (rot * Math.PI) / 180;
    const nx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ny = dx * Math.sin(rad) + dy * Math.cos(rad);
    dx = nx;
    dy = ny;
  }
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  dx /= len;
  dy /= len;
  // 車頭朝前還是朝後：拿現場朝向跟這一塊的現場切線比
  if (headingRad != null && Number.isFinite(headingRad)) {
    const realTan = tangentAlongPath(paths.real, along);
    const dot = Math.cos(headingRad) * realTan.x + Math.sin(headingRad) * realTan.y;
    if (dot < 0) {
      dx = -dx;
      dy = -dy;
    }
  }
  return { x: dx, y: dy };
}

/**
 * 車頭朝向：<strong>順著帶子畫，但把現場的擺動疊上去</strong>。
 *
 * 兩件事要分開。「這條路在圖上往哪走」是示意圖的事——T3 支線在現場是南北向，圖上
 * 卻是橫的帶子；照現場 heading 轉，車會直立橫跨整條帶子。「車頭相對於路偏了幾度」
 * 才是現場的事實：轉彎、蛇行、進站擺正，都在這個差值裡。
 *
 * 所以基準取帶子的方向，再加上「現場 heading 減去現場切線」那個偏差。車始終順著
 * 帶子，該擺動的時候照樣看得到。
 *
 * 沒有 heading 就只有基準方向，沒有擺動可疊。
 */
export function drawnRotateWithSwingDeg(
  track: FacilityObject,
  area: MapAreaObject,
  xM: number,
  yM: number,
  headingRad?: number | null,
): number | null {
  const dir = drawnDirectionAtField(track, area, xM, yM, headingRad ?? undefined);
  if (!dir) return null;
  const base = rotateDegForDrawnDirection(dir);
  if (headingRad == null || !Number.isFinite(headingRad)) return base;

  const paths = getTrackGenPaths(track.parameters);
  if (!paths) return base;
  const { along } = projectAlongPath(paths.real, xM, yM);
  const realTan = tangentAlongPath(paths.real, along);
  let tanRad = Math.atan2(realTan.y, realTan.x);
  // 逆著這一塊畫的方向走時，切線要反過來才是「車頭該對的那一邊」
  if (Math.cos(headingRad) * realTan.x + Math.sin(headingRad) * realTan.y < 0) {
    tanRad += Math.PI;
  }
  let swing = headingRad - tanRad;
  swing = Math.atan2(Math.sin(swing), Math.cos(swing));
  // 現場的角度逆時針為正，CSS rotate 順時針為正
  return base - (swing * 180) / Math.PI;
}

/**
 * 區域座標的方向向量 → 載具容器的旋轉角（度）。
 * 模板 rot=0 時車頭朝西，也就是畫面的 (−1, 0)；CSS rotate 是順時針。
 */
export function rotateDegForDrawnDirection(dir: { x: number; y: number }): number {
  // 區域座標 y 向上，畫面 y 向下
  const sx = dir.x;
  const sy = -dir.y;
  return (Math.atan2(-sy, -sx) * 180) / Math.PI;
}

export function fieldPositionToTrackAreaLocal(
  xM: number,
  yM: number,
  track: FacilityObject,
  area: MapAreaObject,
  options?: { extrapolate?: boolean },
): { x: number; y: number } | null {
  /*
   * 生成的軌道自己帶著真實路徑與圖面路徑，<strong>不必先看場域範圍</strong>。
   *
   * 那四個數字是給手工放的軌道用的：沒有路徑可循時，只能拿一個方框做線性內插。生成的
   * 軌道兩條路徑都在身上，範圍再檢查一次只是多一道會擋掉東西的門——而且那個方框只有
   * 中心線兩側各 1.675 公尺，車子一偏出軌道就整台不見。
   */
  const paths = getTrackGenPaths(track.parameters);
  if (paths) {
    const { along: t, side } = projectAlongPath(paths.real, xM, yM);
    return trackLocalPathPointToAreaLocal(
      track,
      area,
      offsetLocalPoint(
        paths.local,
        t,
        side,
        getTrackGenLatPerBox(track.parameters),
        getTrackGenLatMode(track.parameters),
      ),
    );
  }

  // 手工放的軌道沒有路徑，只能靠場域範圍做線性內插
  if (!hasValidRefFieldBounds(track.parameters)) return null;
  const bounds = getValidRefFieldBounds(track.parameters);
  if (!bounds) return null;
  const span = refFieldBoundsSpanMeters(bounds);
  if (!span) return null;
  const areaPos = resolveFacilityAreaPosition(track, area.domain, area.layout);
  const areaSize = resolveFacilityAreaSize(track, area.domain, area.layout);

  const horizontal = span.w >= span.h;

  let along = horizontal
    ? (xM - bounds.xMinM) / span.w
    : (yM - bounds.yMinM) / span.h;
  if (!options?.extrapolate) {
    along = clamp01(along);
  }

  let localX: number;
  let localY: number;
  if (horizontal) {
    localX = areaPos.x + along * areaSize.w;
    localY = areaPos.y + areaSize.h / 2;
  } else {
    localY = areaPos.y + (1 - along) * areaSize.h;
    localX = areaPos.x + areaSize.w / 2;
  }

  return applyTrackRotation(localX, localY, areaPos, areaSize, readRotationDeg(track));
}

/** 元件有旋轉時，把區域座標繞元件中心轉過去 */
function applyTrackRotation(
  localX: number,
  localY: number,
  areaPos: { x: number; y: number },
  areaSize: { w: number; h: number },
  rotDeg: number,
): { x: number; y: number } {
  if (Math.abs(rotDeg) <= 0.001) return { x: localX, y: localY };
  const cx = areaPos.x + areaSize.w / 2;
  const cy = areaPos.y + areaSize.h / 2;
  const rad = (rotDeg * Math.PI) / 180;
  const dx = localX - cx;
  const dy = localY - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function placementFromTrackInArea(
  xM: number,
  yM: number,
  area: MapAreaObject,
  track: FacilityObject,
): VehicleTrackPlacement | null {
  const local = fieldPositionToTrackAreaLocal(xM, yM, track, area, { extrapolate: false });
  if (!local) return null;
  return {
    areaLocalX: local.x,
    areaLocalY: local.y,
    trackId: track.id,
    score: 1,
  };
}

/** 在單一 Area 內：僅 refField 段內命中才換算（不吸附、不用 domain） */
export function resolveVehicleTrackPlacementInArea(
  xM: number,
  yM: number,
  area: MapAreaObject,
): VehicleTrackPlacement | null {
  /*
   * 命中多段時挑真實中心線最近的。場域範圍是外接方框，彎道與垂直段本來就會
   * 蓋到鄰居；照順序取第一個會讓車子在重疊處左右跳。
   */
  let picked: FacilityObject | null = null;
  let pickedD = Infinity;
  for (const track of area.facilities ?? []) {
    if (track.type !== 'Track') continue;
    const bounds = getValidRefFieldBounds(track.parameters);
    if (!bounds || !fieldPointInRefField(xM, yM, bounds)) continue;
    const score = trackGenPickScore(track.parameters, xM, yM);
    const d = score ?? Infinity;
    if (!picked || d < pickedD) {
      picked = track;
      pickedD = d;
    }
    if (score === null && picked === track) break;
  }
  return picked ? placementFromTrackInArea(xM, yM, area, picked) : null;
}

/**
 * 全圖定位：橫渡線優先，再掃 Track refField。
 *
 * 橫渡線與軌道帶在場域上重疊——若先吸到軌道中心線，轉線途中的車會在上下行之間
 * 「飄／跳」。模擬器路徑點正確、圖台卻飄，多半就是這裡少了橫渡線這一步。
 */
export function resolveVehiclePlacementAcrossAreas(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
  network?: TrackNetwork,
  options?: {
    preferYardPlacement?: boolean;
    payload?: Record<string, unknown>;
    /**
     * 車頭朝向（弧度，場域座標，東為 0、逆時針為正）。
     *
     * 廠商本來就在送（`local_pose.heading`），用來分上下行：兩條線在圖上只差三公尺多，
     * 位置分不出來，走向差 180 度卻一目了然。沒給就退回純距離。
     */
    headingRad?: number;
  },
): VehiclePlacementAcrossAreas | null {
  const net = network ?? getTrackNetwork(areas);
  const preferYard = options?.preferYardPlacement === true;

  if (preferYard) {
    return resolveYardFacilityPlacement(areas, options?.payload);
  }

  // 緊貼橫渡線（2 m）：即使同時落在軌道帶 AABB 裡，也畫在渡線上
  const onCrossover = locateOnCrossover(areas, xM, yM, 2);
  if (onCrossover) return onCrossover;

  const onTrack = locateOnTrackNetwork(net, xM, yM, options?.headingRad);
  if (onTrack) return onTrack;

  // 略寬：portal 外緣、尚未落入任何 refField 的點
  const onCrossoverLoose = locateOnCrossover(areas, xM, yM, 6);
  if (onCrossoverLoose) return onCrossoverLoose;

  // 場區底下沒有軌道：開進去的那幾秒沒有 yard_slot_id，照分區的對應反算
  const inZone = locateInZonePartition(areas, xM, yM);
  if (inZone) return inZone;

  return locateInAreaDomain(areas, xM, yM);
}

/** 圖台標籤：僅在 refField 段內時回傳軌道代碼 */
export function resolveTrackCodeForDisplay(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
  network?: TrackNetwork,
): string | null {
  const net = network ?? getTrackNetwork(areas);
  return trackCodeAtFieldPoint(net, xM, yM);
}

export { buildTrackNetwork, getTrackNetwork, type TrackNetwork };
export { findRefFieldOverlaps } from './trackNetwork/validate';
