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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OperationOrder,
      OperationRoute,
      OperationRouteStation,
      OperationRouteStationAction,
      OrderActionState,
      OrderEvent,
    ]),
    AuditModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderRouteService, OrderMqttPublisher],
  exports: [OrderService, OrderRouteService],
})
export class OrderModule {}
