import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MqttService } from './mqtt.service';
import { MqttController } from './mqtt.controller';
import { TelemetryWriteQueue } from './telemetry-write.queue';
import { RedisModule } from '../redis/redis.module';
import { OrderModule } from '../order/order.module';
import { MapModule } from '../map/map.module';
import { CommandLog } from '../database/entities/command-log.entity';
import { SecurityEventLog } from '../database/entities/security-event-log.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { SlotStatus_ } from '../database/entities/slot-status.entity';

@Module({
  imports: [
    RedisModule,
    OrderModule,
    MapModule,
    TypeOrmModule.forFeature([CommandLog, SecurityEventLog, TelemetryLog, SlotStatus_]),
  ],
  providers: [MqttService, TelemetryWriteQueue],
  controllers: [MqttController],
})
export class MqttModule {}
