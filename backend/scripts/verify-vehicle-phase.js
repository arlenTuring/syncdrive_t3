#!/usr/bin/env node
/**
 * 訂閱 operation/update，印出 vehicle_phase（驗收 FAULTED 用）
 *
 * 用法：node backend/scripts/verify-vehicle-phase.js [PMS-05]
 */
const mqtt = require('mqtt');

const vehicleCode = process.argv[2] || 'PMS-05';
const mqttUrl = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const topic = `v1/vtms/${vehicleCode}/operation/update`;
const timeoutMs = 30_000;
let sawFaulted = false;

const client = mqtt.connect(mqttUrl, { clientId: `verify-phase-${process.pid}` });

const timer = setTimeout(() => {
  console.log(sawFaulted ? '\n✅ 已觀測到 FAULTED' : '\n⏱️  逾時：未看到 FAULTED');
  client.end();
  process.exit(sawFaulted ? 0 : 1);
}, timeoutMs);

client.on('connect', () => {
  console.log(`Listening ${topic} (${timeoutMs / 1000}s)...`);
  client.subscribe(topic);
});

client.on('message', (t, buf) => {
  if (t !== topic) return;
  try {
    const payload = JSON.parse(buf.toString());
    const phase = payload.vehicle_phase ?? '—';
    const ts = new Date(payload.timestamp || Date.now()).toISOString();
    console.log(`[${ts}] vehicle_phase=${phase}  trip=${payload.trip_code ?? '—'}`);
    if (phase === 'FAULTED') {
      sawFaulted = true;
      clearTimeout(timer);
      console.log('\n✅ 驗收通過：operation/update 回報 FAULTED');
      client.end();
      process.exit(0);
    }
  } catch {
    /* ignore */
  }
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
  process.exit(1);
});
