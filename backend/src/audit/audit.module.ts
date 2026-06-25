import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorActionLog } from '../database/entities/operator-action-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperatorActionLog])],
  providers: [AuditService],
  exports: [AuditService], // 開放給其他 Module 注入使用
})
export class AuditModule {}
