import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardPlane } from '../database/entities/dashboard-plane.entity';
import { ModuleDashboardPage } from '../database/entities/module-dashboard-page.entity';
import { DashboardPlaneController } from './dashboard-plane.controller';
import { DashboardPlaneService } from './dashboard-plane.service';

@Module({
  imports: [TypeOrmModule.forFeature([DashboardPlane, ModuleDashboardPage])],
  controllers: [DashboardPlaneController],
  providers: [DashboardPlaneService],
  exports: [DashboardPlaneService],
})
export class DashboardPlaneModule {}
