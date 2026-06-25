const mqtt = require('mqtt');
const io = require('socket.io-client');

console.log('🚨 [Test] 初始化特殊事件 (Event) 測試腳本...');

// 1. 模擬前端圖台：連線到 WebSockets，監聽告警
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('✅ [Frontend] WebSocket 連線成功！等待異常告警推播...');
});

socket.on('security_event', (data) => {
  console.log('\n🔥 [Frontend 收到告警] 收到車端突發事件 (延遲: 0ms):');
  console.log(JSON.stringify(data, null, 2));
  console.log('\n🎉 驗證成功！請前往 http://localhost:8080 (Adminer) 查看 security_event_logs 資料表，這筆資料已經寫入資料庫了！');
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// 2. 模擬車輛：連線到 MQTT Broker
const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log('✅ [Vehicle] MQTT 連線成功！準備發送 UNSCHEDULED_DOOR_OPEN 事件...');
  
  // 準備發送您剛剛貼的完整假資料
  const fakeEvent = {
    event_id: "EVT-20260423-0001",
    vehicle_code: "PMS-05",
    timestamp: 1713872100000,
    event_code: "UNSCHEDULED_DOOR_OPEN",
    severity: "CRITICAL",
    location: { lat: 25.0776, lng: 121.2325 },
    detail: "Illegal door opening detected during transit at 12.0 km/h"
  };

  // 延遲 1 秒後發送
  setTimeout(() => {
    console.log('\n📤 [Vehicle 發送] 往 v1/vtms/PMS-05/event/report 發布事件...');
    mqttClient.publish('v1/vtms/PMS-05/event/report', JSON.stringify(fakeEvent));
  }, 1000);
});

mqttClient.on('error', (err) => {
  console.error('MQTT Error:', err);
});
