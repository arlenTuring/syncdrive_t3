#!/usr/bin/env node
/**
 * 驗收用：中心端下發 EMERGENCY_STOP → 車端應 command/ack + event/report + operation vehicle_phase=FAULTED
 *
 * 用法：node backend/scripts/trigger-emergency-stop.js [PMS-05]
 * 前置：後端 + 模擬器已啟動，目標車已在正線班次（PROCESSING）
 */
const vehicleCode = process.argv[2] || 'PMS-05';
const apiBase = process.env.SYNC_API || 'http://127.0.0.1:3000/syncdrive-api';

async function main() {
  const res = await fetch(`${apiBase}/command/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle_code: vehicleCode,
      action: 'EMERGENCY_STOP',
      params: { deceleration: 'MAX', hazard_light: true },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Command failed:', res.status, body);
    process.exit(1);
  }
  console.log('EMERGENCY_STOP sent:', body);
  console.log('');
  console.log('驗收：另開終端執行');
  console.log(`  node backend/scripts/verify-vehicle-phase.js ${vehicleCode}`);
  console.log('預期 5 秒內看到 vehicle_phase: FAULTED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
