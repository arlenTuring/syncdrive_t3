import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacilitySlot } from '../database/entities/facility-slot.entity';
import { MaintenanceTaskModule } from '../maintenance-task/maintenance-task.module';
import { MapModule } from '../map/map.module';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { FacilityService } from './facility.service';
import { FacilityController } from './facility.controller';
import { MaintenanceDistributionController } from './maintenance-distribution.controller';
import { MaintenanceDistributionService } from './maintenance-distribution.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FacilitySlot]),
    OperationShiftModule,
    MaintenanceTaskModule,
    MapModule,
  ],
  providers: [FacilityService, MaintenanceDistributionService],
  controllers: [FacilityController, MaintenanceDistributionController],
  exports: [FacilityService, MaintenanceDistributionService],
})
export class FacilityModule {}
