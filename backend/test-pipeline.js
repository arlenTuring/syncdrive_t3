const mqtt = require('mqtt');
const io = require('socket.io-client');

console.log('🚗 [Test] 初始化 SyncDrive 測試腳本...');

// 1. 模擬前端圖台：連線到 WebSockets
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('✅ [Frontend] WebSocket 連線成功！等待資料推播...');
});

socket.on('telemetry/PMS-05', (data) => {
  console.log('\n🚀 [Frontend 收到推播] 收到 PMS-05 即時動態 (延遲: 0ms):');
  console.log(JSON.stringify(data, null, 2));
  console.log('\n🎉 驗證成功！MQTT -> Redis -> WebSocket 資料管線全線暢通！');
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// 2. 模擬車輛：連線到 MQTT Broker
const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log('✅ [Vehicle] MQTT 連線成功！準備發送 Telemetry 資料...');
  
  // 準備發送符合 Telemetry 協議的完整假資料
  const fakeTelemetry = {
    vehicle_code: "PMS-05",
    timestamp: Date.now(),
    global_pose: {
      latitude: 25.077612,
      longitude: 121.232545,
      altitude: 6.15
    },
    local_pose: {
      position: { x: 176330.86, y: 1969.98, z: 6.15 },
      orientation: { w: 0.6865, x: 0.0, y: 0.0, z: -0.7271 },
      heading: 1.49
    },
    kinematics: {
      velocity: 10.5,
      acceleration: 0.2,
      angular_velocity: 0.01
    },
    actuation_feedback: {
      throttle: 15.2,
      brake: 0.0,
      steering_angle: -0.0145,
      gear: "D"
    },
    energy: {
      battery_level: 85.0
    },
    signals: {
      turn_indicator: "NONE",
      hazard_light: false
    },
    prediction: {
      path: [
        { x: 176331.0, y: 1970.1 },
        { x: 176332.5, y: 1971.5 }
      ]
    }
  };

  // 延遲 1 秒後發送，確保 WebSocket 準備好
  setTimeout(() => {
    console.log('\n📤 [Vehicle 發送] 往 v1/vtms/PMS-05/telemetry/update 發布資料...');
    mqttClient.publish('v1/vtms/PMS-05/telemetry/update', JSON.stringify(fakeTelemetry));
  }, 1000);
});

mqttClient.on('error', (err) => {
  console.error('MQTT Error:', err);
});
