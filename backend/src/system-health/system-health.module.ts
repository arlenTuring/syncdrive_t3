import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { DatasourceModule } from '../datasource/datasource.module';
import { RedisModule } from '../redis/redis.module';
import { MonitoringThresholdsService } from './monitoring-thresholds.service';
import { HttpsCertificateService } from './https-certificate.service';
import { SystemFoundationController } from './system-foundation.controller';
import { SystemFoundationSettingsService } from './system-foundation-settings.service';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';

@Module({
  imports: [
    DatasourceModule,
    RedisModule,
    TypeOrmModule.forFeature([SystemSetting]),
  ],
  controllers: [SystemHealthController, SystemFoundationController],
  providers: [
    SystemHealthService,
    MonitoringThresholdsService,
    SystemFoundationSettingsService,
    HttpsCertificateService,
  ],
  exports: [
    SystemHealthService,
    MonitoringThresholdsService,
    SystemFoundationSettingsService,
  ],
})
export class SystemHealthModule {}
