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

@Module({
  imports: [TypeOrmModule.forFeature([DataAdminAudit]), RedisModule, MqttModule, DemoSimulationModule],
  controllers: [DataAdminController],
  providers: [DataAdminService, DataAdminGuard, LiveDataResetService],
})
export class DataAdminModule {}
