import { Module } from '@nestjs/common';
import { MapModule } from '../map/map.module';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { MapActivationController } from './map-activation.controller';
import { MapActivationService } from './map-activation.service';

@Module({
  imports: [MapModule, OperationShiftModule],
  controllers: [MapActivationController],
  providers: [MapActivationService],
})
export class MapActivationModule {}
