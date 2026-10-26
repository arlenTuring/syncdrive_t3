import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRouteService } from './order-route.service';
import { OperationOrder } from '../database/entities/operation-order.entity';
import { OperationRoute } from '../database/entities/operation-route.entity';
import { OperationRouteStation } from '../database/entities/operation-route-station.entity';
import { OperationRouteStationAction } from '../database/entities/operation-route-station-action.entity';
import { OrderActionState } from '../database/entities/order-action-state.entity';
import { OrderEvent } from '../database/entities/order-event.entity';
import { OrderMqttPublisher } from './order-mqtt.publisher';
import { AuditModule } from '../audit/audit.module';
import { MapModule } from '../map/map.module';
import { SystemHealthModule } from '../system-health/system-health.module';
import { ScheduledOrderEntry } from '../database/entities/scheduled-order-entry.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { ScheduledOrderService } from './scheduled-order.service';
import { ScheduledOrderController } from './scheduled-order.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OperationOrder,
      OperationRoute,
      OperationRouteStation,
      OperationRouteStationAction,
      OrderActionState,
      OrderEvent,
      ScheduledOrderEntry,
      SystemSetting,
      Vehicle,
    ]),
    AuditModule,
    MapModule,
    SystemHealthModule,
  ],
  controllers: [OrderController, ScheduledOrderController],
  providers: [
    OrderService,
    OrderRouteService,
    OrderMqttPublisher,
    ScheduledOrderService,
  ],
  exports: [OrderService, OrderRouteService, ScheduledOrderService],
})
export class OrderModule {}
