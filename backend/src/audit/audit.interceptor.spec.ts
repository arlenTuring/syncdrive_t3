import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditAction } from './audit-action.decorator';
import { AuditInterceptor } from './audit.interceptor';
import { redact } from './audit-catalog';

class Sample {
  @AuditAction('SHIFT_UPDATE')
  update() {}

  @AuditAction('DEGRADED_EXECUTE', { correlation: (_req, result) => (result as { id: string }).id })
  execute() {}

  list() {}
}

function context(handler: () => void, request: Record<string, unknown>): ExecutionContext {
  return { getType: () => 'http', getHandler: () => handler, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
const call = (value: unknown): CallHandler => ({ handle: () => of(value) });
const fail = (error: unknown): CallHandler => ({ handle: () => throwError(() => error) });

describe('AuditInterceptor', () => {
  const writes: Array<Record<string, unknown>> = [];
  const interceptor = new AuditInterceptor(new Reflector(), { write: async (dto: Record<string, unknown>) => void writes.push(dto) } as never);
  const request = (body: unknown = { name: '早班', operatorId: 'spoofed', password: 'x' }) => ({
    authUser: { id: 'acc-1', display_name: '王小明' },
    params: { id: 'S-9' },
    body,
    ip: '10.0.0.5',
    header: (name: string) => (name === 'user-agent' ? 'UA' : undefined),
  });
  beforeEach(() => (writes.length = 0));

  it('成功：操作者取自 session（不信 body.operatorId）、目標取路由參數、只記錄變更欄位名稱', async () => {
    await lastValueFrom(interceptor.intercept(context(Sample.prototype.update, request()), call({ id: 'S-9', name: '早班' })));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ operatorId: 'acc-1', operatorName: '王小明', sourceIp: '10.0.0.5', actionType: 'SHIFT_UPDATE', targetId: 'S-9', targetName: '早班', result: 'SUCCESS' });
    expect(writes[0].actionDetail).toEqual({ fields: ['name', 'operatorId', 'password'] });
  });

  it('400 等被拒記 REJECTED；500 記 FAILED；例外照常拋出', async () => {
    await expect(lastValueFrom(interceptor.intercept(context(Sample.prototype.update, request()), fail(new BadRequestException('名稱重複'))))).rejects.toThrow('名稱重複');
    await expect(lastValueFrom(interceptor.intercept(context(Sample.prototype.update, request()), fail(new Error('db down'))))).rejects.toThrow('db down');
    expect(writes.map((w) => w.result)).toEqual(['REJECTED', 'FAILED']);
    expect(writes[0].failureReason).toBe('名稱重複');
  });

  it('連結業務紀錄 ID；沒有標註的端點（查詢）不寫', async () => {
    await lastValueFrom(interceptor.intercept(context(Sample.prototype.execute, request({})), call({ id: 'EXE-1' })));
    await lastValueFrom(interceptor.intercept(context(Sample.prototype.list, request({})), call([])));
    expect(writes).toHaveLength(1);
    expect(writes[0].correlationId).toBe('EXE-1');
  });

  it('遮蔽敏感欄位', () => {
    expect(redact({ password: 'p', apiKey: 'k', nested: { token: 't', ok: 1 }, definitionKey: 'bus' })).toEqual({ password: '[已遮蔽]', apiKey: '[已遮蔽]', nested: { token: '[已遮蔽]', ok: 1 }, definitionKey: 'bus' });
  });
});
