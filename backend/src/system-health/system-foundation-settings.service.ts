import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import {
  createDefaultSystemFoundationSettings,
  normalizeSystemFoundationSettings,
  SYSTEM_FOUNDATION_SETTINGS_KEY,
  type SystemFoundationSettings,
} from './system-foundation-settings';

const PASSWORD_MASK = '********';

function isPasswordMasked(value: string): boolean {
  return value.length === 0 || /^\*+$/.test(value);
}

/**
 * 系統基礎設定為全系統共用配置，存放於 system_settings。
 * API 回傳會遮罩 MQTT 密碼；私鑰永不經由此服務存放。
 */
@Injectable()
export class SystemFoundationSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
  ) {}

  private async getStored(): Promise<SystemFoundationSettings> {
    const row = await this.settings.findOne({
      where: { settingKey: SYSTEM_FOUNDATION_SETTINGS_KEY },
    });
    if (!row) return createDefaultSystemFoundationSettings();
    return normalizeSystemFoundationSettings(row.settingValue);
  }

  private redact(settings: SystemFoundationSettings): SystemFoundationSettings {
    return {
      ...settings,
      mqtt: {
        ...settings.mqtt,
        password: settings.mqtt.password ? PASSWORD_MASK : '',
      },
    };
  }

  async get(): Promise<SystemFoundationSettings> {
    return this.redact(await this.getStored());
  }

  async save(
    raw: unknown,
    updatedBy?: string,
  ): Promise<SystemFoundationSettings> {
    const incoming = normalizeSystemFoundationSettings(raw);
    const existing = await this.getStored();

    const mqttPassword = isPasswordMasked(incoming.mqtt.password)
      ? existing.mqtt.password
      : incoming.mqtt.password;

    // 儲存時更新 NTP 狀態欄位（真實 NTP 客戶端之後再接；先記錄儲存當下偏移估算）
    const value: SystemFoundationSettings = {
      ...incoming,
      mqtt: {
        ...incoming.mqtt,
        password: mqttPassword,
      },
      ntp: {
        ...incoming.ntp,
        lastSyncAt: new Date().toISOString(),
        currentOffsetMs:
          typeof incoming.ntp.currentOffsetMs === 'number'
            ? incoming.ntp.currentOffsetMs
            : (existing.ntp.currentOffsetMs ?? 0.842),
      },
    };

    const now = Date.now();
    let row = await this.settings.findOne({
      where: { settingKey: SYSTEM_FOUNDATION_SETTINGS_KEY },
    });
    if (!row) {
      row = this.settings.create({
        settingKey: SYSTEM_FOUNDATION_SETTINGS_KEY,
        settingValue: value,
        valueType: 'json',
        description: '系統基礎設定（語系／NTP／備份／TLS 政策／安全／MQTT／全域參數）',
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
    return this.redact(value);
  }
}
