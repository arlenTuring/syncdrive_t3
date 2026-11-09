import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { OperatingDayModule } from '../operating-day/operating-day.module';
import { OrderModule } from '../order/order.module';
import { VehicleRotationController } from './vehicle-rotation.controller';
import { VehicleRotationService } from './vehicle-rotation.service';
import { RotationRuntimeStore } from './rotation.store';

@Module({
  imports: [DispatchModule, OperatingDayModule, OrderModule],
  controllers: [VehicleRotationController],
  providers: [VehicleRotationService, RotationRuntimeStore],
})
export class VehicleRotationModule {}
