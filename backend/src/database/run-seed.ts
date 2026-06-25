/**
 * 手動執行種子：npm run seed:dashboard（需 Postgres 可連線）
 */
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'syncdrive_user',
  password: process.env.DB_PASSWORD || 'syncdrive_password',
  database: process.env.DB_NAME || 'syncdrive_t3',
});

async function runSeed() {
  try {
    await AppDataSource.initialize();
    for (const file of [
      'seed.sql',
      'seed-dashboard-demo.sql',
      'seed-dashboard-panels.sql',
      'seed-dashboard-capacity-trend.sql',
      'seed-dashboard-maintenance.sql',
      'seed-dashboard-shifts.sql',
      'seed-dashboard-refresh-timestamps.sql',
    ]) {
      const sqlPath = path.join(__dirname, file);
      if (!fs.existsSync(sqlPath)) continue;
      console.log(`Executing ${file}…`);
      await AppDataSource.query(fs.readFileSync(sqlPath, 'utf8'));
    }
    console.log('Seed completed.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

runSeed();
