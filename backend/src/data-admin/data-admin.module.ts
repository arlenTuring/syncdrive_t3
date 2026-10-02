import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataAdminAudit } from '../database/entities/data-admin-audit.entity';
import { DataAdminController } from './data-admin.controller';
import { DataAdminGuard } from './data-admin.guard';
import { DataAdminService } from './data-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([DataAdminAudit])],
  controllers: [DataAdminController],
  providers: [DataAdminService, DataAdminGuard],
})
export class DataAdminModule {}
