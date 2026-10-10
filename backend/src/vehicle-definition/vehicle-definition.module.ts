import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardPlane } from '../database/entities/dashboard-plane.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { VehicleDefinition } from '../database/entities/vehicle-definition.entity';
import { MapVehicleSettingsService } from './map-vehicle-settings.service';
import {
  MapVehicleSettingsController,
  VehicleDefinitionController,
} from './vehicle-definition.controller';
import { VehicleDefinitionService } from './vehicle-definition.service';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleDefinition, SystemSetting, DashboardPlane])],
  controllers: [VehicleDefinitionController, MapVehicleSettingsController],
  providers: [VehicleDefinitionService, MapVehicleSettingsService],
  exports: [VehicleDefinitionService, MapVehicleSettingsService],
})
export class VehicleDefinitionModule {}
