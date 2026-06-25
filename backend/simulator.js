const mqtt = require('mqtt');
const { Client } = require('pg');

async function main() {
  console.log('🚀 Starting SyncDrive T3 Simulator...');

  // 1. Database connection
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'syncdrive_user',
    password: process.env.DB_PASSWORD || 'syncdrive_password',
    database: process.env.DB_NAME || 'syncdrive_t3',
  });

  try {
    await db.connect();
    console.log('✅ Connected to Postgres database');

    // Seed Vehicles
    const vehicleCountRes = await db.query('SELECT count(*) FROM vehicles');
    const count = parseInt(vehicleCountRes.rows[0].count);
    if (count < 1000) {
      console.log(`Seeding ${1000 - count} vehicles...`);
      for (let i = count; i < 1000; i++) {
        await db.query(`INSERT INTO vehicles (vehicle_code, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [`V-${i}`, `AGV-${i}`]);
      }
      console.log('✅ Vehicles seeded');
    }

    // Seed slot_statuses
    await db.query(`
      CREATE TABLE IF NOT EXISTS slot_statuses (
        slot_id VARCHAR PRIMARY KEY,
        status VARCHAR NOT NULL
      )
    `);
    
    // Check if slot_statuses has 'status' column
    try {
        await db.query(`ALTER TABLE slot_statuses ADD COLUMN IF NOT EXISTS status VARCHAR`);
    } catch(e) {}

    const slots = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
    for (const slot of slots) {
      const status = Math.random() > 0.3 ? 'OCCUPIED' : 'AVAILABLE';
      await db.query(`
        INSERT INTO slot_statuses (slot_id, status) VALUES ($1, $2)
        ON CONFLICT (slot_id) DO UPDATE SET status = $2
      `, [slot, status]);
    }
    console.log('✅ Slot statuses seeded');

    // Seed operator_action_logs
    for (let i = 0; i < 20; i++) {
      const type = ['COMMAND_DISPATCH', 'ORDER_CREATE', 'ORDER_UPDATE', 'SPEED_LIMIT_SET'][Math.floor(Math.random() * 4)];
      const result = ['SUCCESS', 'FAILED', 'REJECTED'][Math.floor(Math.random() * 3)];
      await db.query(`
        INSERT INTO operator_action_logs (operator_id, action_type, target_vehicle, result)
        VALUES ('admin', $1, 'System', $2)
      `, [type, result]);
    }
    console.log('✅ Operator action logs seeded');

  } catch (err) {
    console.error('Database seeding failed:', err);
  }

  // 2. MQTT connection
  const mqttClient = mqtt.connect('mqtt://localhost:1883');
  
  mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    
    // Simulation Loop
    setInterval(() => {
      // Top row route progress (PMS-01 to PMS-08)
      for (let i = 1; i <= 8; i++) {
        const name = `PMS-${i.toString().padStart(2, '0')}`;
        const progress = Math.floor((Date.now() / 1000 + i * 10) % 100);
        
        mqttClient.publish(`v1/agv/${name}/status`, JSON.stringify({
          payload: {
            progress: progress,
            route: 'R-1',
            status: 'ONLINE'
          }
        }));
      }

      // Bottom row gauges (PMS-01 to PMS-11)
      for (let i = 1; i <= 11; i++) {
        const name = `PMS-${i.toString().padStart(2, '0')}`;
        const speed = (Math.random() * 2 + 1).toFixed(1);
        const soc = Math.floor(Math.random() * 20 + 80); // 80-100%
        
        mqttClient.publish(`v1/agv/${name}/telemetry`, JSON.stringify({
          payload: {
            speed: parseFloat(speed),
            soc: soc,
            status: 'ONLINE'
          }
        }));

        // Also insert into telemetry_logs for the chart
        if (name === 'PMS-01' || name === 'AGV-001') {
            db.query(`
              INSERT INTO telemetry_logs (vehicle_code, raw_payload)
              VALUES ($1, $2)
            `, ['AGV-001', JSON.stringify({ soc })]).catch(() => {});
        }
      }
      
    }, 2000);
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT Error:', err);
  });
}

main();
