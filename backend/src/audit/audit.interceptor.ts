import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../access-control/access.guard';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { AUDIT_ACTION, type AuditActionOptions } from './audit-action.decorator';
import { AuditService } from './audit.service';

/** 只記錄變更了哪些欄位（名稱），不存值：值可能很大或含敏感資料 */
function changedFields(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const keys = Object.keys(body as Record<string, unknown>).filter((key) => !['expected_version', 'version'].includes(key));
  return keys.length ? { fields: keys.slice(0, 40) } : undefined;
}

function pickName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  for (const key of ['name', 'display_name', 'displayName', 'title', 'shift_name', 'shiftName', 'template_name', 'templateName', 'plan_name']) {
    if (typeof v[key] === 'string' && v[key]) return String(v[key]);
  }
  return null;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const meta = this.reflector.get<{ code: string; options: AuditActionOptions } | undefined>(AUDIT_ACTION, context.getHandler());
    if (!meta) return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return from(this.run(request, meta.code, meta.options, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }

  private async run(request: AuthenticatedRequest, code: string, options: AuditActionOptions, handle: () => Promise<unknown>) {
    let result: unknown;
    let error: unknown = null;
    try {
      result = await handle();
    } catch (err) {
      error = err;
    }
    const status = error instanceof HttpException ? error.getStatus() : error ? 500 : 200;
    const safe = <T>(fn: (() => T) | undefined): T | undefined => {
      try {
        return fn?.();
      } catch {
        return undefined;
      }
    };
    const target = safe(() => options.target?.(request, result)) ?? null;
    const paramId = request.params?.[options.param ?? 'id'];
    const user = request.authUser;
    // 稽核寫入失敗：操作已經完成（不能回滾），回應照常，但失敗計數可監測（見 AuditService.write）
    await this.audit.write({
      operatorId: user?.id ?? (request.header('x-api-key') ? 'external-api' : 'anonymous'),
      operatorName: user?.display_name ?? null,
      sourceIp: request.ip,
      userAgent: request.header('user-agent') ?? null,
      actionType: code,
      targetId: target?.id ?? (paramId ? String(paramId) : null),
      targetName: target?.name ?? (error ? null : pickName(result)) ?? pickName(request.body),
      targetVehicle: target?.vehicle ?? undefined,
      actionDetail: safe(() => options.detail?.(request, result)) ?? changedFields(request.body),
      result: !error ? ActionResult.SUCCESS : status < 500 ? ActionResult.REJECTED : ActionResult.FAILED,
      failureReason: error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : undefined,
      correlationId: error ? null : safe(() => options.correlation?.(request, result)) ?? null,
    });
    if (error) throw error;
    return result;
  }
}
