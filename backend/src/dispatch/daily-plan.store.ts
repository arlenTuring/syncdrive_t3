import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { DatasourceInvalidationService, DS_TAGS } from '../events/datasource-invalidation.service';
import { dailyPlanSettingKey, type DailyPlanAdoption } from './daily-plan';

/**
 * 每日計畫採用紀錄的存取（存在既有的 system_settings，一個營運日一筆）。
 * 寫入後發班次中心的失效通知，畫面立刻改用新的分母。
 */
@Injectable()
export class DailyPlanStore {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async get(day: string): Promise<DailyPlanAdoption | null> {
    const row = await this.settings.findOne({ where: { settingKey: dailyPlanSettingKey(day) } });
    const value = row?.settingValue as DailyPlanAdoption | undefined;
    if (!value || typeof value.shift_id !== 'string' || !Array.isArray(value.passenger_trips)) return null;
    const needsUpgrade = value.passenger_trips.some((trip) => !trip.id || trip.classification !== 'passenger');
    if (!needsUpgrade) return value;
    const upgraded: DailyPlanAdoption = {
      ...value,
      passenger_trips: value.passenger_trips.map((trip) => ({
        ...trip,
        id: trip.id || `${value.operating_day}:${value.shift_id}:${value.plan_digest}:${trip.code}`,
        classification: 'passenger',
      })),
    };
    if (row) {
      row.settingValue = upgraded;
      await this.settings.save(row);
    }
    return upgraded;
  }

  async save(adoption: DailyPlanAdoption): Promise<void> {
    const key = dailyPlanSettingKey(adoption.operating_day);
    const existing = await this.settings.findOne({ where: { settingKey: key } });
    if (existing) {
      existing.settingValue = adoption;
      existing.updatedAt = Date.now();
      existing.updatedBy = adoption.adopted_by ?? existing.updatedBy;
      await this.settings.save(existing);
    } else {
      await this.settings.save(this.settings.create({
        settingKey: key,
        settingValue: adoption,
        valueType: 'json',
        description: `${adoption.operating_day} 採用的每日計畫`,
        updatedBy: adoption.adopted_by ?? undefined,
      }));
    }
    this.invalidation.emit([DS_TAGS.SHIFT_CENTER, DS_TAGS.CAPACITY_TREND], 'daily_plan');
  }
}
