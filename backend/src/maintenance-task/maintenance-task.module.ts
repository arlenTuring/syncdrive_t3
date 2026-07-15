import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenanceTask } from '../database/entities/maintenance-task.entity';
import { MaintenanceTaskController } from './maintenance-task.controller';
import { MaintenanceTaskSeedService } from './maintenance-task-seed.service';
import { MaintenanceTaskService } from './maintenance-task.service';

@Module({
  imports: [TypeOrmModule.forFeature([MaintenanceTask])],
  controllers: [MaintenanceTaskController],
  providers: [MaintenanceTaskService, MaintenanceTaskSeedService],
  exports: [MaintenanceTaskService],
})
export class MaintenanceTaskModule {}
