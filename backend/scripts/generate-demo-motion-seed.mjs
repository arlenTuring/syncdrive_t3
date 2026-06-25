/**
 * 依 t3-v0-0-5-track-motion 產生示範車隊種子座標（refField 段內）。
 *
 * 執行：node backend/scripts/generate-demo-motion-seed.mjs
 */
const motion = require('./t3-v0-0-5-track-motion');

const STAGGER_MS = [0, 180_000, 360_000, 540_000];
const simStartMs = Date.now();

console.log('-- vehicle_monitor_demo segment_label + operation_orders payload (fleet)');
for (let i = 0; i < motion.FLEET.length; i++) {
  const vehicle = motion.FLEET[i];
  const elapsedMs = vehicle.offsetMin * 60 * 1000 + STAGGER_MS[i];
  const m = motion.getVehicleMotion(vehicle.id, elapsedMs, simStartMs, { managed: true });
  if (!m) continue;
  const progress = Math.round(m.progress * 100);
  console.log(
    `${vehicle.id}: segment=${m.track} x=${m.x} y=${m.y} leg=${m.leg} progress=${progress}% trip=${m.tripCode}`,
  );
}
