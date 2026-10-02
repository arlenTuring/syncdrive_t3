import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataAdminGuard } from './data-admin.guard';

function context(headers: Record<string, string>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as unknown as ExecutionContext;
}

describe('DataAdminGuard', () => {
  it('denies an employee before any database operation', () => {
    const guard = new DataAdminGuard({ get: () => '' } as unknown as ConfigService);
    expect(() => guard.canActivate(context({ 'x-syncdrive-role': 'employee' }))).toThrow(ForbiddenException);
  });

  it('requires the configured server-side admin key', () => {
    const guard = new DataAdminGuard({ get: () => 'secret' } as unknown as ConfigService);
    expect(() => guard.canActivate(context({ 'x-syncdrive-role': 'supervisor' }))).toThrow(UnauthorizedException);
    expect(guard.canActivate(context({
      'x-syncdrive-role': 'supervisor',
      'x-syncdrive-admin-key': 'secret',
    }))).toBe(true);
  });
});
