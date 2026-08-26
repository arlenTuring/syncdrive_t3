import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationOrder } from '../database/entities/operation-order.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { OrderModule } from '../order/order.module';
import { DispatchController } from './dispatch.controller';
import { DispatchEngineService } from './dispatch-engine.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle, OperationOrder]),
    OperationShiftModule,
    OrderModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchEngineService],
  exports: [DispatchEngineService],
})
export class DispatchModule {}
