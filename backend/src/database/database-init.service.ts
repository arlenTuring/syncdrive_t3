import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(private dataSource: DataSource) {}

  async onApplicationBootstrap() {
    this.logger.log('Checking TimescaleDB configuration...');

    try {
      // 1. 確保 TimescaleDB 擴充功能已安裝
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`);
      
      // 2. 檢查 telemetry_logs 是否已經是 hypertable
      const isHypertable = await this.dataSource.query(`
        SELECT * FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'telemetry_logs';
      `);

      if (isHypertable.length === 0) {
        this.logger.log('Converting telemetry_logs to hypertable...');
        // 將普通表轉為超表，以 timestamp 作為時間分割依據
        await this.dataSource.query(`
          SELECT create_hypertable('telemetry_logs', 'timestamp', if_not_exists => TRUE);
        `);
      }

      // 3. 設定自動壓縮策略 (7天)
      // 首先檢查壓縮功能是否已啟用
      const isCompressionEnabled = await this.dataSource.query(`
        SELECT compression_enabled FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'telemetry_logs';
      `);

      if (isCompressionEnabled.length > 0 && !isCompressionEnabled[0].compression_enabled) {
        this.logger.log('Enabling compression for telemetry_logs...');
        await this.dataSource.query(`
          ALTER TABLE telemetry_logs SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_code'
          );
        `);

        // 加入自動壓縮排程 (7天)
        await this.dataSource.query(`
          SELECT add_compression_policy('telemetry_logs', INTERVAL '7 days');
        `);
        this.logger.log('Compression policy set (7 days).');
      }

      // 4. 自動刪除 7 天前的遙測 chunk，避免 demo/MQTT 灌爆磁碟
      try {
        await this.dataSource.query(`
          SELECT add_retention_policy('telemetry_logs', INTERVAL '7 days', if_not_exists => TRUE);
        `);
        this.logger.log('Retention policy set for telemetry_logs (7 days).');
      } catch (retentionErr) {
        this.logger.warn('Could not set telemetry retention policy (may already exist)', retentionErr);
      }

      this.logger.log('TimescaleDB setup completed successfully.');
    } catch (error) {
      this.logger.error('Failed to setup TimescaleDB', error);
    }
  }
}
