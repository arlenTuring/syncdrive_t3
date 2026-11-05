import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationOrder } from '../database/entities/operation-order.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { DailyPlanStore } from './daily-plan.store';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { OrderModule } from '../order/order.module';
import { MaintenanceTaskModule } from '../maintenance-task/maintenance-task.module';
import { DispatchController } from './dispatch.controller';
import { DispatchEngineService } from './dispatch-engine.service';
import { SimulationPlanService } from './simulation-plan.service';
import { MapModule } from '../map/map.module';
import { TripDelayMonitorService } from './trip-delay-monitor.service';
import { SystemHealthModule } from '../system-health/system-health.module';
import { RotationOverlayStore } from './rotation-overlay.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle, OperationOrder, SystemSetting]),
    OperationShiftModule,
    OrderModule,
    MaintenanceTaskModule,
    MapModule,
    SystemHealthModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchEngineService, SimulationPlanService, DailyPlanStore, TripDelayMonitorService, RotationOverlayStore],
  exports: [DispatchEngineService, DailyPlanStore],
})
export class DispatchModule {}
