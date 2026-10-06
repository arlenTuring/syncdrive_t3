import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { DatasourceInvalidationService, DS_TAGS } from '../events/datasource-invalidation.service';
import {
  applyClockUpdate,
  describeClock,
  operatingTimeAt,
  REALTIME_CLOCK,
  type ClockState,
  type ClockUpdate,
} from './operating-clock';
import { operatingDayOf } from './operating-day';

const SETTING_KEY = 'operation.operating_clock';

/**
 * 全系統共用的營運時鐘（規則見 operating-clock.ts）。
 *
 * 狀態存在記憶體，換段時寫進 system_settings，重啟後接得回來；心跳只更新記憶體。
 * 不分資料來源：正式車端與模擬器都照同一個時鐘換算，只有「誰推進時鐘」不同。
 */
@Injectable()
export class OperatingClockService implements OnModuleInit {
  private readonly logger = new Logger(OperatingClockService.name);
  private state: ClockState = { ...REALTIME_CLOCK };

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const row = await this.settings.findOne({ where: { settingKey: SETTING_KEY } });
      const saved = row?.settingValue as ClockState | undefined;
      if (saved && (saved.mode === 'realtime' || saved.mode === 'replay') && Array.isArray(saved.segments)) {
        this.state = { ...REALTIME_CLOCK, ...saved };
      }
    } catch (error) {
      this.logger.warn(`讀不到營運時鐘狀態，先用實際時間：${(error as Error).message}`);
    }
  }

  /** 此刻（或某個實際時刻）的營運時間 */
  now(realTs = Date.now()): number {
    return operatingTimeAt(this.state, realTs, Date.now());
  }

  /** 實際時刻 → 營運時刻（訂單開始、結束時記錄用） */
  toOperating(realTs: number): number {
    return operatingTimeAt(this.state, realTs, Date.now());
  }

  /** 目前的營運日：重播時是重播的那一天，否則是營運時間的當天 */
  operatingDay(realTs = Date.now()): string {
    return this.state.mode === 'replay' && this.state.operatingDay
      ? this.state.operatingDay
      : operatingDayOf(this.now(realTs));
  }

  snapshot(realNow = Date.now()) {
    return describeClock(this.state, realNow);
  }

  async update(update: ClockUpdate, realNow = Date.now()) {
    const before = this.state;
    const next = applyClockUpdate(before, update, realNow);
    this.state = next;
    const segmentChanged =
      before.mode !== next.mode
      || before.runId !== next.runId
      || before.ended !== next.ended
      || before.segments.length !== next.segments.length
      || before.segments.at(-1) !== next.segments.at(-1);
    if (segmentChanged) {
      await this.persist();
      this.invalidation.emit([DS_TAGS.OPERATING_CLOCK, DS_TAGS.SHIFT_CENTER], 'operating_clock');
    }
    return this.snapshot(realNow);
  }

  private async persist(): Promise<void> {
    try {
      const existing = await this.settings.findOne({ where: { settingKey: SETTING_KEY } });
      if (existing) {
        existing.settingValue = this.state;
        existing.updatedAt = Date.now();
        await this.settings.save(existing);
      } else {
        await this.settings.save(this.settings.create({
          settingKey: SETTING_KEY,
          settingValue: this.state,
          valueType: 'json',
          description: '營運時鐘（重播時由執行端推進；正式營運為實際時間）',
        }));
      }
    } catch (error) {
      this.logger.warn(`營運時鐘狀態沒存進資料庫（記憶體仍有效）：${(error as Error).message}`);
    }
  }
}
