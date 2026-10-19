import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OperatorActionLog, OperatorActionType, ActionResult } from '../database/entities/operator-action-log.entity';
import { auditInfo, redact } from './audit-catalog';

export interface WriteAuditDto {
  /** 後端驗證過的操作者（session 帳號 ID）；外部整合填 'external-api'，自動任務填 'system' */
  operatorId?: string;
  operatorName?: string | null;
  sourceIp?: string;
  userAgent?: string | null;
  actionType: OperatorActionType | string;
  targetVehicle?: string;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  actionDetail?: Record<string, any>;
  result: ActionResult;
  failureReason?: string;
  correlationId?: string | null;
}

/** 稽核寫入失敗次數（可由健康檢查讀取；不是無限佇列） */
let auditWriteFailures = 0;
export const auditFailureCount = () => auditWriteFailures;

/**
 * 統一稽核紀錄服務（系統操作紀錄／營運操作紀錄）。
 *
 * - 分類、目標類型由 audit-catalog.ts 依代碼決定；呼叫端不能自己宣告分類。
 * - 內容一律經 redact() 遮蔽敏感欄位、限制大小，不整包存 request。
 * - 傳入 manager 時與業務異動同一筆交易（失敗一起回滾）；否則獨立寫入，失敗會丟出例外給呼叫端，
 *   由呼叫端決定是否中止（不再只打 log 當作已寫入）。writeBestEffort 給「不能因稽核失敗而中斷」的控制路徑用，
 *   失敗計數可監測。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(OperatorActionLog)
    private readonly auditRepo: Repository<OperatorActionLog>,
  ) {}

  private row(dto: WriteAuditDto): Partial<OperatorActionLog> {
    const info = auditInfo(String(dto.actionType));
    const targetVehicle = dto.targetVehicle || null;
    return {
      operatorId: dto.operatorId ?? 'system',
      operatorNameSnapshot: dto.operatorName ?? null,
      sourceIp: dto.sourceIp ?? (null as unknown as string),
      userAgent: dto.userAgent ? dto.userAgent.slice(0, 300) : null,
      actionType: String(dto.actionType),
      category: info?.category ?? null,
      targetVehicle: targetVehicle as string,
      targetType: dto.targetType ?? (targetVehicle ? 'VEHICLE' : info?.targetType ?? null),
      targetId: (dto.targetId ?? targetVehicle ?? null)?.slice(0, 128) ?? null,
      targetNameSnapshot: dto.targetName ? dto.targetName.slice(0, 200) : null,
      actionDetail: dto.actionDetail ? redact(dto.actionDetail) : null,
      result: dto.result,
      failureReason: dto.failureReason ? String(redact(dto.failureReason)) : (null as unknown as string),
      correlationId: dto.correlationId ? dto.correlationId.slice(0, 128) : null,
      createdAt: String(Date.now()),
    };
  }

  /** 寫入稽核；有 manager 時加入該交易。失敗丟出例外。 */
  async record(dto: WriteAuditDto, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(OperatorActionLog) : this.auditRepo;
    await repo.insert(this.row(dto) as OperatorActionLog);
  }

  /**
   * 不中斷主要流程的寫入（車控、外部回報等不能因稽核故障失去控制能力的路徑）。
   * 失敗會計數並記錄錯誤，供監測；不重試、不重送任何車控。
   */
  async write(dto: WriteAuditDto): Promise<void> {
    try {
      await this.record(dto);
    } catch (err) {
      auditWriteFailures += 1;
      this.logger.error(`[Audit] 稽核寫入失敗（累計 ${auditWriteFailures}）：${dto.actionType}`, err as Error);
    }
  }
}
