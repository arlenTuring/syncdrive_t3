import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorActionLog } from '../database/entities/operator-action-log.entity';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

/** 全域：任何 Controller 都能用 @AuditAction 標註，或注入 AuditService 在交易內寫入 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OperatorActionLog])],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
