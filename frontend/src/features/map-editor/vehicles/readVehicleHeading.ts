/** 從 MQTT telemetry 讀取車頭朝向（弧度） */
export function readVehicleHeadingRad(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null;

  const localPose = payload.local_pose;
  if (localPose && typeof localPose === 'object') {
    const lp = localPose as Record<string, unknown>;
    if (typeof lp.heading === 'number' && Number.isFinite(lp.heading)) {
      return lp.heading;
    }
    const orient = lp.orientation;
    if (orient && typeof orient === 'object') {
      const o = orient as { w?: number; z?: number };
      if (typeof o.z === 'number' && typeof o.w === 'number') {
        return 2 * Math.atan2(o.z, o.w);
      }
    }
  }

  if (typeof payload.heading === 'number' && Number.isFinite(payload.heading)) {
    return payload.heading;
  }

  return null;
}

/** 從 MQTT telemetry 讀取轉向角（弧度，actuation_feedback.steering_angle） */
export function readVehicleSteeringAngleRad(
  payload: Record<string, unknown> | undefined,
): number | null {
  if (!payload) return null;

  const actuation = payload.actuation_feedback;
  if (actuation && typeof actuation === 'object') {
    const angle = (actuation as Record<string, unknown>).steering_angle;
    if (typeof angle === 'number' && Number.isFinite(angle)) {
      return angle;
    }
  }

  if (typeof payload.steering_angle === 'number' && Number.isFinite(payload.steering_angle)) {
    return payload.steering_angle;
  }

  return null;
}

function normalizeHeadingRad(headingRad: number): number {
  let h = headingRad;
  while (h > Math.PI) h -= 2 * Math.PI;
  while (h < -Math.PI) h += 2 * Math.PI;
  return h;
}

/** 順時針方位角（度，東=0、南=90、西=180、北=270） */
export function headingRadToClockwiseDeg(headingRad: number): number {
  let deg = (headingRad * 180) / Math.PI;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return deg;
}

/**
 * 順時針 heading → 地圖繞後軸旋轉角（度）。
 *
 * 載具模板 rot=0 時車頭朝西（cw=180°）。車頭對準 heading：
 *   rot = cw − 180
 */
function clockwiseHeadingToContainerRotateDeg(
  headingRad: number,
  landscape: boolean,
): number {
  const cw = headingRadToClockwiseDeg(headingRad);
  const rot = cw - 180;
  return landscape ? rot : rot - 90;
}

/**
 * 載具樣板在地圖上的旋轉角（度）。
 */
export function mapHeadingRadToRotationDeg(
  headingRad: number | null | undefined,
  landscape: boolean,
): number | undefined {
  if (headingRad == null || !Number.isFinite(headingRad)) return undefined;

  const h = normalizeHeadingRad(headingRad);
  const verticalBand = Math.PI / 4;

  if (Math.abs(h - Math.PI / 2) < verticalBand) {
    return landscape ? 90 : 0;
  }
  if (Math.abs(h + Math.PI / 2) < verticalBand) {
    return landscape ? -90 : 0;
  }

  return 0;
}

/**
 * 繞後軸旋轉角（度）：僅依 heading，不另做車燈補償或轉向角覆寫。
 */
export function mapVehiclePivotRotateDeg(
  headingRad: number | null | undefined,
  landscape: boolean,
  _steeringRad?: number | null,
): number | undefined {
  if (headingRad == null || !Number.isFinite(headingRad)) return undefined;
  return clockwiseHeadingToContainerRotateDeg(headingRad, landscape);
}

/**
 * 地圖載具容器旋轉（度），僅由 heading 決定。
 */
export function mapHeadingRadToContainerRotateDeg(
  headingRad: number | null | undefined,
  landscape: boolean,
): number | undefined {
  if (headingRad == null || !Number.isFinite(headingRad)) return undefined;
  return clockwiseHeadingToContainerRotateDeg(headingRad, landscape);
}
