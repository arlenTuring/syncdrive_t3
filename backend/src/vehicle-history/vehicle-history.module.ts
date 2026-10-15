import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DegradedReplayMap } from '../database/entities/degraded-replay.entities';
import {
  VehicleHistoryFrame,
  VehicleHistoryGap,
  VehicleHistorySegment,
  VehicleHistoryStreamKey,
} from '../database/entities/vehicle-history.entities';
import { MapModule } from '../map/map.module';
import { VehicleDefinitionModule } from '../vehicle-definition/vehicle-definition.module';
import { VehicleHistoryController } from './vehicle-history.controller';
import { VehicleHistoryRecorder } from './vehicle-history.recorder';
import { VehicleHistoryService } from './vehicle-history.service';

/**
 * 一般運行歷史：保存（MQTT 入口呼叫 recorder）與查詢（運行管理紀錄回放）。
 * 不依賴 MQTT、降級模組；它們引用這裡，不會繞成循環。
 */
@Module({
  imports: [
    MapModule,
    VehicleDefinitionModule,
    TypeOrmModule.forFeature([
      VehicleHistoryFrame,
      VehicleHistorySegment,
      VehicleHistoryGap,
      VehicleHistoryStreamKey,
      DegradedReplayMap,
    ]),
  ],
  controllers: [VehicleHistoryController],
  providers: [VehicleHistoryRecorder, VehicleHistoryService],
  exports: [VehicleHistoryRecorder, VehicleHistoryService],
})
export class VehicleHistoryModule {}
