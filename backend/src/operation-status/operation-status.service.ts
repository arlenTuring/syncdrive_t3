import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DegradedOperationService } from '../degraded-operation/degraded-operation.service';
import { resolveOperationStatus, type OperationStatusRow } from './operation-status';

/** 即時調度引擎開關（同 DispatchEngineService.ENABLED_SETTING） */
const DISPATCH_ENABLED_SETTING = 'dispatch.execution.enabled';

@Injectable()
export class OperationStatusService {
  private readonly logger = new Logger(OperationStatusService.name);

  constructor(
    private readonly degraded: DegradedOperationService,
    private readonly dataSource: DataSource,
  ) {}

  async getStatus(): Promise<OperationStatusRow> {
    let degradedMode: 'normal' | 'degraded' | 'unknown' | null = null;
    let degradedPlanName: string | null = null;
    try {
      const status = await this.degraded.getOperationStatus();
      degradedMode = status.mode as 'normal' | 'degraded' | 'unknown';
      degradedPlanName = status.active_execution?.name ?? null;
    } catch (error) {
      this.logger.warn(`讀不到降級狀態：${(error as Error).message}`);
    }
    const [shiftRows, settingRows] = await Promise.all([
      this.dataSource.query(
        "SELECT name FROM operation_shifts WHERE usage_status = 'in_use' ORDER BY updated_at DESC LIMIT 1",
      ) as Promise<Array<{ name: string }>>,
      this.dataSource.query('SELECT setting_value FROM system_settings WHERE setting_key = $1', [
        DISPATCH_ENABLED_SETTING,
      ]) as Promise<Array<{ setting_value: unknown }>>,
    ]);
    return resolveOperationStatus({
      degradedMode,
      degradedPlanName,
      scheduleName: shiftRows[0]?.name ?? null,
      // 還沒寫過開關時，調度引擎第一次檢查會寫入預設值；這之前先當作暫停（不假裝正常）
      dispatchEnabled: settingRows[0]?.setting_value === true,
    });
  }
}
