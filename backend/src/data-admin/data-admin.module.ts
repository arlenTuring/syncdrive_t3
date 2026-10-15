import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataAdminAudit } from '../database/entities/data-admin-audit.entity';
import { DataAdminController } from './data-admin.controller';
import { DataAdminGuard } from './data-admin.guard';
import { DataAdminService } from './data-admin.service';
import { LiveDataResetService } from './live-data-reset.service';
import { RedisModule } from '../redis/redis.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { DemoSimulationModule } from '../demo/demo-simulation.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { DataCleanupJob, DataCleanupPlan, DataRetentionPolicy } from '../database/entities/data-retention.entities';
import { VehicleHistoryModule } from '../vehicle-history/vehicle-history.module';
import { DegradedReplayModule } from '../degraded-replay/degraded-replay.module';
import { DataRetentionService } from './data-retention.service';

@Module({
  imports: [TypeOrmModule.forFeature([DataAdminAudit, DataCleanupJob, DataCleanupPlan, DataRetentionPolicy]), RedisModule, MqttModule, DemoSimulationModule, DispatchModule, VehicleHistoryModule, DegradedReplayModule],
  controllers: [DataAdminController],
  providers: [DataAdminService, DataAdminGuard, LiveDataResetService, DataRetentionService],
})
export class DataAdminModule {}
