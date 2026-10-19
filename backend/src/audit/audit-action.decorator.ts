import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditActionCode } from './audit-catalog';

export const AUDIT_ACTION = 'audit:action';

export type AuditTarget = { id?: string | null; name?: string | null; vehicle?: string | null };

export type AuditActionOptions = {
  /** 目標 ID 取自哪個路由參數（預設 id） */
  param?: string;
  /** 由請求與回應決定目標（ID、當時名稱、相關載具） */
  target?: (request: Request, result: unknown) => AuditTarget | null | undefined;
  /** 要保存的內容摘要（會再經遮蔽）；預設只記錄有變更的欄位名稱 */
  detail?: (request: Request, result: unknown) => Record<string, unknown> | undefined;
  /** 連結的業務紀錄 ID（command／order／degraded 等） */
  correlation?: (request: Request, result: unknown) => string | null | undefined;
};

/**
 * 標註「這個 API 是需要稽核的修改操作」。全域 AuditInterceptor 在處理完成後寫一筆系統／營運操作紀錄：
 * 成功 SUCCESS；400／403／404／409 等被拒 REJECTED；其他錯誤 FAILED。
 * GET 與輪詢不要標註（查詢不產生日誌）。
 */
export const AuditAction = (code: AuditActionCode, options: AuditActionOptions = {}) =>
  SetMetadata(AUDIT_ACTION, { code, options });

/** 從後端驗證過的請求取得操作者、IP、裝置（不接受 body 宣告的 operatorId） */
export function auditActor(request: Request & { authUser?: { id: string; display_name: string } }) {
  return {
    operatorId: request.authUser?.id ?? (request.header('x-api-key') ? 'external-api' : 'system'),
    operatorName: request.authUser?.display_name ?? null,
    sourceIp: request.ip,
    userAgent: request.header('user-agent') ?? null,
  };
}
