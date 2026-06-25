import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { Vehicle } from './database/entities/vehicle.entity';
import { OperationOrder } from './database/entities/operation-order.entity';
import { CommandLog } from './database/entities/command-log.entity';
import { SecurityEventLog } from './database/entities/security-event-log.entity';
import { TelemetryLog } from './database/entities/telemetry-log.entity';
import { OperatorActionLog } from './database/entities/operator-action-log.entity';
import { SpeedLimitConfig } from './database/entities/speed-limit-config.entity';
import { JunctionInterlockLog } from './database/entities/junction-interlock-log.entity';
import { FieldEquipmentStatus } from './database/entities/field-equipment-status.entity';
import { FacilitySlot } from './database/entities/facility-slot.entity';
import { SlotStatus_ } from './database/entities/slot-status.entity';
import { CapacityTrendDemoPoint } from './database/entities/capacity-trend-demo-point.entity';
import { OperationRoute } from './database/entities/operation-route.entity';
import { OperationRouteStation } from './database/entities/operation-route-station.entity';
import { OperationRouteStationAction } from './database/entities/operation-route-station-action.entity';
import { OrderActionState } from './database/entities/order-action-state.entity';
import { OrderEvent } from './database/entities/order-event.entity';
import { OrderModule } from './order/order.module';
import { CommandModule } from './command/command.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { DatasourceModule } from './datasource/datasource.module';
import { FacilityModule } from './facility/facility.module';
import { DemoSimulationModule } from './demo/demo-simulation.module';
import { MapModule } from './map/map.module';
import { DatabaseInitService } from './database/database-init.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'syncdrive_user'),
        password: configService.get<string>('DB_PASSWORD', 'syncdrive_password'),
        database: configService.get<string>('DB_NAME', 'syncdrive_t3'),
        entities: [
          Vehicle, OperationOrder, CommandLog, SecurityEventLog, TelemetryLog,
          OperatorActionLog, SpeedLimitConfig, JunctionInterlockLog, FieldEquipmentStatus,
          FacilitySlot, SlotStatus_, CapacityTrendDemoPoint,
          OperationRoute, OperationRouteStation, OperationRouteStationAction,
          OrderActionState, OrderEvent,
        ],
        // SAFETY: synchronize=true auto-migrates schema on startup.
        // MUST be false in production to avoid accidental column drops.
        synchronize: configService.get<string>('NODE_ENV', 'development') !== 'production',
        logging: configService.get<string>('DB_LOGGING', 'false') === 'true',
        retryAttempts: 15,
        retryDelay: 2000,
      }),
      inject: [ConfigService],
    }),
    MqttModule,
    RedisModule,
    EventsModule,
    OrderModule,
    CommandModule,
    VehicleModule,
    DatasourceModule,
    FacilityModule,
    DemoSimulationModule,
    MapModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseInitService],
})
export class AppModule {}
