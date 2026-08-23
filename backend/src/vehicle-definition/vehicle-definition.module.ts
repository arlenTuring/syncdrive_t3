import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleDefinition } from '../database/entities/vehicle-definition.entity';
import { VehicleDefinitionController } from './vehicle-definition.controller';
import { VehicleDefinitionService } from './vehicle-definition.service';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleDefinition])],
  controllers: [VehicleDefinitionController],
  providers: [VehicleDefinitionService],
  exports: [VehicleDefinitionService],
})
export class VehicleDefinitionModule {}
