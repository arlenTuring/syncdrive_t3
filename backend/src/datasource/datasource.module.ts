import { Module } from '@nestjs/common';
import { DatasourceController } from './datasource.controller';
import { DatasourceService } from './datasource.service';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';

@Module({
  controllers: [DatasourceController],
  providers: [DatasourceService, DashboardDemoSeedService],
  exports: [DatasourceService],
})
export class DatasourceModule {}
