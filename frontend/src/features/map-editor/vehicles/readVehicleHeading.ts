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

/**
 * 順時針方位角（度，東=0、南=90、西=180、北=270）。
 *
 * <h3>為什麼要反號</h3>
 * 協議的 <code>local_pose.heading</code> 是車端 ROS2 map frame 的朝向，由四元數
 * （繞 z 軸）轉出來的——<strong>x 向東、y 向北、逆時針為正</strong>。畫面的方位角
 * 是順時針的，兩者旋轉方向相反。
 *
 * 少了這個負號，橫向剛好看不出來（0 與 180 反號之後還是自己），縱向卻整個顛倒：
 * 往北開的車被算成朝南，畫出來的車頭朝下。斜接與圓角上則是沿水平軸鏡射。
 * 實測 heading ＝ +90°（正北）會算出 rotate −90°，車頭指向畫面下方。
 */
export function headingRadToClockwiseDeg(headingRad: number): number {
  // 取餘數再位移，才不會在 heading 為 0 時留下 −0
  const deg = (-headingRad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
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

/**
 * 從 MQTT telemetry 讀車速（公尺／秒）。
 *
 * 車端介接說明書把 kinematics.velocity 定義成 m/s，原值即可。沒有這個欄位回 null——呼叫端不要當成 0：
 * 「不知道」跟「停著」對定位的意義不一樣。
 */
export function readVehicleSpeedMps(
  payload: Record<string, unknown> | undefined,
): number | null {
  if (!payload) return null;
  const kin = payload.kinematics;
  if (!kin || typeof kin !== 'object') return null;
  const v = (kin as Record<string, unknown>).velocity;
  return typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : null;
}
