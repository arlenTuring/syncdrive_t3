import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class DataAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = String(request.headers['x-syncdrive-role'] ?? '').toLowerCase();
    if (role !== 'supervisor') {
      throw new ForbiddenException('資料管理介面僅限主管使用');
    }

    const expectedKey = this.config.get<string>('DATA_ADMIN_API_KEY', '').trim();
    if (expectedKey && request.headers['x-syncdrive-admin-key'] !== expectedKey) {
      throw new UnauthorizedException('管理 API 金鑰無效');
    }
    return true;
  }
}
