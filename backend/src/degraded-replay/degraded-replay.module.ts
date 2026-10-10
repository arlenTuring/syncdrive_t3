import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DegradedOperationEvent } from '../database/entities/degraded-operation-event.entity';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import {
  DegradedReplayFrame,
  DegradedReplayMap,
  DegradedReplaySession,
} from '../database/entities/degraded-replay.entities';
import { MapModule } from '../map/map.module';
import { RedisModule } from '../redis/redis.module';
import { VehicleDefinitionModule } from '../vehicle-definition/vehicle-definition.module';
import { DegradedReplayRecorder } from './degraded-replay.recorder';
import { DegradedReplayService } from './degraded-replay.service';

/**
 * 降級回放：保存（MQTT 入口呼叫 recorder）與查詢（降級運轉 API 呼叫 service）。
 * 不依賴降級運轉模組本身，MQTT 模組引用它不會繞成循環。
 */
@Module({
  imports: [
    RedisModule,
    MapModule,
    VehicleDefinitionModule,
    TypeOrmModule.forFeature([
      DegradedReplaySession,
      DegradedReplayMap,
      DegradedReplayFrame,
      DegradedOperationExecution,
      DegradedOperationEvent,
    ]),
  ],
  providers: [DegradedReplayRecorder, DegradedReplayService],
  exports: [DegradedReplayRecorder, DegradedReplayService],
})
export class DegradedReplayModule {}
