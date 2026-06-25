const mqtt = require('mqtt');

// Connect to Mosquitto MQTT broker
const client = mqtt.connect('mqtt://127.0.0.1:1883');

const vehicles = ['AGV-001', 'AGV-002', 'AMR-101', 'AMR-102'];

let speed = 2.5;
let soc = 85;
let progress = 0;

client.on('connect', () => {
  console.log('Connected to MQTT Broker. Simulating telemetry...');

  setInterval(() => {
    // Simulate slight fluctuations
    speed = Math.max(0, Math.min(5, speed + (Math.random() * 0.4 - 0.2)));
    soc = Math.max(0, soc - 0.05);
    progress = (progress + 1) % 100;

    vehicles.forEach(v => {
      // 1. Publish Telemetry (for Gauges)
      client.publish(`v1/agv/${v}/telemetry`, JSON.stringify({
        payload: {
          speed: parseFloat(speed.toFixed(1)),
          soc: parseFloat(soc.toFixed(1)),
        }
      }));

      // 2. Publish Status (for RouteProgress & StatusBadge)
      const statusMap = {
        'AGV-001': 'ONLINE',
        'AGV-002': 'IDLE',
        'AMR-101': 'ONLINE',
        'AMR-102': 'OFFLINE'
      };

      client.publish(`v1/agv/${v}/status`, JSON.stringify({
        payload: {
          status: statusMap[v],
          progress: progress,
          route: 'Route A -> B'
        }
      }));
    });

  }, 1000); // 1 update per second
});

client.on('error', (err) => {
  console.error('MQTT Connection Error:', err);
});
