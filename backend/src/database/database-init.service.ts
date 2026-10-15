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

      // 4. 保留政策改由資料管理介面統一呈現與管理。已存在的 TimescaleDB
      // 政策不會在升級時被關閉或縮短；新安裝也不會在未經使用者確認時自動啟用刪除。
      try {
        const policies = await this.dataSource.query(`
          SELECT job_id, config FROM timescaledb_information.jobs
          WHERE proc_name='policy_retention' AND hypertable_name='telemetry_logs';
        `);
        this.logger.log(policies.length
          ? 'Existing telemetry retention policy detected; it will be shown as externally managed.'
          : 'No telemetry retention policy enabled (safe default).');
      } catch (retentionErr) {
        this.logger.warn('Could not inspect telemetry retention policy', retentionErr);
      }

      this.logger.log('TimescaleDB setup completed successfully.');
    } catch (error) {
      this.logger.error('Failed to setup TimescaleDB', error);
    }
  }
}
