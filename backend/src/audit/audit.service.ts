import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OperatorActionLog,
  OperatorActionType,
  ActionResult,
} from '../database/entities/operator-action-log.entity';

export interface WriteAuditDto {
  operatorId?: string;
  sourceIp?: string;
  actionType: OperatorActionType;
  targetVehicle?: string;
  actionDetail?: Record<string, any>;
  result: ActionResult;
  failureReason?: string;
}

/**
 * 統一稽核紀錄服務
 * 規格書 §系統操作紀錄：中心端每一個操作均需留下可稽核的日誌
 * 注入此 Service 的任何 Controller/Service 都可以呼叫 write() 寫入紀錄
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(OperatorActionLog)
    private readonly auditRepo: Repository<OperatorActionLog>,
  ) {}

  async write(dto: WriteAuditDto): Promise<void> {
    try {
      const log = this.auditRepo.create({
        operatorId: dto.operatorId ?? 'system',
        sourceIp: dto.sourceIp ?? null,
        actionType: dto.actionType,
        targetVehicle: dto.targetVehicle ?? null,
        actionDetail: dto.actionDetail ?? null,
        result: dto.result,
        failureReason: dto.failureReason ?? null,
      } as any);
      await this.auditRepo.save(log);
    } catch (err) {
      // 稽核寫入失敗不應該中斷主要業務流程，只記錄警告
      this.logger.error('[Audit] Failed to write audit log', err);
    }
  }
}
