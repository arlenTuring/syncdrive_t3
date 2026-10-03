import { Module } from '@nestjs/common';
import { DatasourceController } from './datasource.controller';
import { DatasourceService } from './datasource.service';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource_ } from '../database/entities/data-source.entity';
import { DatasourceDefinitionsService } from './datasource-definitions.service';

@Module({
  imports: [TypeOrmModule.forFeature([DataSource_])],
  controllers: [DatasourceController],
  providers: [DatasourceService, DatasourceDefinitionsService, DashboardDemoSeedService],
  exports: [DatasourceService, DatasourceDefinitionsService],
})
export class DatasourceModule {}
