import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import {
  createDefaultMonitoringThresholds,
  MONITORING_THRESHOLDS_SETTING_KEY,
  normalizeMonitoringThresholds,
  type MonitoringThresholdSettings,
} from './monitoring-thresholds';

/**
 * 監測閾值為系統共用配置（非個人偏好），存放於 system_settings。
 */
@Injectable()
export class MonitoringThresholdsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
  ) {}

  async get(): Promise<MonitoringThresholdSettings> {
    const row = await this.settings.findOne({
      where: { settingKey: MONITORING_THRESHOLDS_SETTING_KEY },
    });
    if (!row) return createDefaultMonitoringThresholds();
    return normalizeMonitoringThresholds(row.settingValue);
  }

  async save(
    raw: unknown,
    updatedBy?: string,
  ): Promise<MonitoringThresholdSettings> {
    const value = normalizeMonitoringThresholds(raw);
    const now = Date.now();
    let row = await this.settings.findOne({
      where: { settingKey: MONITORING_THRESHOLDS_SETTING_KEY },
    });
    if (!row) {
      row = this.settings.create({
        settingKey: MONITORING_THRESHOLDS_SETTING_KEY,
        settingValue: value,
        valueType: 'json',
        description: '系統監測閾值設定（通知人員／告警條件）',
        updatedBy: updatedBy || undefined,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      row.settingValue = value;
      row.valueType = 'json';
      if (updatedBy) row.updatedBy = updatedBy;
      row.updatedAt = now;
    }
    await this.settings.save(row);
    return value;
  }
}
