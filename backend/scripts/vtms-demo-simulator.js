/**
 * VTMS 儀表板範例 — MQTT 模擬器
 * 發布 v1/vtms/PMS-01〜11/{telemetry|health|operation}/update
 * 需：MQTT broker (1883)、Nest 後端 (3000) 已啟動以轉發 Socket.IO
 *
 * 執行：node scripts/vtms-demo-simulator.js
 */
const mqtt = require('mqtt');

const VEHICLES = Array.from({ length: 11 }, (_, i) =>
  `PMS-${String(i + 1).padStart(2, '0')}`,
);

const TRIP_SEGMENTS = ['station_6', 'station_4', 'station_1', 'D01', 'D12', 'D22', 'D33'];

/** 作動行為輪播（對應 dashboard operation_action / 圖示庫） */
const OPERATION_ACTIONS = [
  'door_open',
  'door_close',
  'signal',
  'music',
  'dispatch',
  'charging',
  'wash',
  'maintenance',
  'repair',
  'parking',
  'alert',
];

function telemetry(vehicleCode, speed, battery, x, y) {
  return {
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    x,
    y,
    global_pose: { latitude: 25.0776, longitude: 121.2325, altitude: 6.0 },
    local_pose: {
      position: { x, y, z: 6.0 },
      orientation: { w: 1, x: 0, y: 0, z: 0 },
      heading: 1.49,
    },
    kinematics: { velocity: speed, acceleration: 0.1, angular_velocity: 0.01 },
    actuation_feedback: { throttle: 12, brake: 0, steering_angle: 0, gear: 'D' },
    energy: { battery_level: battery },
    signals: { turn_indicator: 'NONE', hazard_light: false },
  };
}

/** 對齊 vehicle_monitor_demo 種子（PMS-01～04 四態示範） */
const HEALTH_PROFILES = [
  {
    overall: 'OK',
    alert_message: '',
    subsystems: { COMPUTING: 'OK', SENSING: 'OK', COMMUNICATION: 'OK', CHASSIS: 'OK' },
  },
  {
    overall: 'WARNING',
    alert_message: '感測資料異常',
    subsystems: { COMPUTING: 'OK', SENSING: 'WARNING', COMMUNICATION: 'OK', CHASSIS: 'OK' },
  },
  {
    overall: 'ERROR',
    alert_message: '運算模組回報錯誤',
    subsystems: { COMPUTING: 'ERROR', SENSING: 'OK', COMMUNICATION: 'OK', CHASSIS: 'OK' },
  },
  {
    overall: 'OFFLINE',
    alert_message: '',
    subsystems: {
      COMPUTING: 'OFFLINE',
      SENSING: 'OFFLINE',
      COMMUNICATION: 'OFFLINE',
      CHASSIS: 'OFFLINE',
    },
  },
];

function health(vehicleCode, profile) {
  const sub = (status) => ({ status });
  const subs = profile.subsystems;
  return {
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    overall_health: profile.overall,
    alert_message: profile.alert_message ?? '',
    status_computing: subs.COMPUTING,
    status_sensing: subs.SENSING,
    status_communication: subs.COMMUNICATION,
    status_chassis: subs.CHASSIS,
    subsystems: {
      COMPUTING: sub(subs.COMPUTING),
      SENSING: sub(subs.SENSING),
      COMMUNICATION: sub(subs.COMMUNICATION),
      CHASSIS: sub(subs.CHASSIS),
    },
  };
}

function operation(vehicleCode, progress, segment, actionCode, segmentIndex, segmentRemainPct) {
  return {
    vehicle_code: vehicleCode,
    timestamp: Date.now(),
    operation_action: actionCode,
    current_leg: {
      target_station_id: segment,
      progress_percent: progress,
    },
    route_progress: progress,
    segment_index: segmentIndex,
    segment_remain_pct: segmentRemainPct,
  };
}

function healthForIndex(idx) {
  if (idx < HEALTH_PROFILES.length) return HEALTH_PROFILES[idx];
  return HEALTH_PROFILES[idx % HEALTH_PROFILES.length];
}

async function main() {
  const url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  const clientId = `vtms-dashboard-demo-sim-${process.pid}`;
  const client = mqtt.connect(url, { clientId, clean: true });

  /** 每台車的區段進度（獨立前進，方便觀察站間移動） */
  const motion = VEHICLES.map((_, idx) => ({
    segmentIndex: idx % 2,
    segmentRemainPct: 55 + (idx * 11) % 40,
    segmentDurationSec: 38 + (idx % 5) * 8,
  }));

  client.on('connect', () => {
    console.log(`VTMS demo simulator connected (${url})`);

    setInterval(() => {
      const t = Date.now() / 1000;
      VEHICLES.forEach((vid, idx) => {
        const m = motion[idx];
        const speed = 14 + (idx % 5) + Math.sin(t + idx) * 2;
        const battery = 62 + ((idx * 7 + Math.floor(t)) % 33);
        const dropPerTick = (100 / m.segmentDurationSec) * 0.5;
        m.segmentRemainPct -= dropPerTick;
        if (m.segmentRemainPct <= 0 && m.segmentIndex < 2) {
          m.segmentIndex += 1;
          m.segmentRemainPct = 100 + m.segmentRemainPct;
        }
        if (m.segmentIndex >= 2) {
          m.segmentRemainPct = Math.max(0, m.segmentRemainPct);
        }

        const progress = Math.min(
          100,
          Math.round((m.segmentIndex * 50) + (1 - m.segmentRemainPct / 100) * 50),
        );
        const seg = TRIP_SEGMENTS[(idx + m.segmentIndex + 1) % TRIP_SEGMENTS.length];
        const x = 400 + idx * 120 + progress * 8;
        const y = 200 + (idx % 3) * 180;
        const action =
          OPERATION_ACTIONS[(idx + Math.floor(t / 6)) % OPERATION_ACTIONS.length];

        client.publish(
          `v1/vtms/${vid}/telemetry/update`,
          JSON.stringify(telemetry(vid, speed, battery, x, y)),
        );
        client.publish(
          `v1/vtms/${vid}/health/heartbeat`,
          JSON.stringify(health(vid, healthForIndex(idx))),
        );
        client.publish(
          `v1/vtms/${vid}/operation/update`,
          JSON.stringify(
            operation(
              vid,
              progress,
              seg,
              action,
              m.segmentIndex,
              Math.round(m.segmentRemainPct),
            ),
          ),
        );
      });
    }, 500);

    setInterval(() => {
      const base = 1080 + Math.round(Math.sin(Date.now() / 8000) * 80);
      client.publish(
        'v1/vtms/dashboard/capacity/live',
        JSON.stringify({
          live_val: base,
          target_val: 1200,
          timestamp: Date.now(),
        }),
      );
    }, 2000);
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });
}

main();
