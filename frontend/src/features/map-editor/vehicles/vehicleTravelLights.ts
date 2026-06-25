/** 依行進方向決定左右車燈：左=head_light_on、右=tail_light_on */
export function computeVehicleLightsFromHeading(headingRad: number): {
  head_light_on: boolean;
  tail_light_on: boolean;
} {
  let h = headingRad;
  while (h > Math.PI) h -= 2 * Math.PI;
  while (h < -Math.PI) h += 2 * Math.PI;

  const cos = Math.cos(h);
  const sin = Math.sin(h);

  if (Math.abs(cos) >= Math.abs(sin)) {
    if (cos > 0) {
      return { head_light_on: false, tail_light_on: true };
    }
    return { head_light_on: true, tail_light_on: false };
  }

  // 順時針 heading：SOUTH=+90°(sin>0)、NORTH=−90°(sin<0)
  if (sin > 0) {
    return { head_light_on: true, tail_light_on: false };
  }
  return { head_light_on: true, tail_light_on: false };
}
