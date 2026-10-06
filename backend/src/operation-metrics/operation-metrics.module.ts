import { Module } from '@nestjs/common';
import { FacilityModule } from '../facility/facility.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RedisModule } from '../redis/redis.module';
import { StationEtaService } from './station-eta.service';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { TimeTemplateModule } from '../time-template/time-template.module';
import { OperationMetricsController } from './operation-metrics.controller';
import { OperationMetricsService } from './operation-metrics.service';

@Module({
  imports: [OperationShiftModule, TimeTemplateModule, FacilityModule, DispatchModule, RedisModule],
  controllers: [OperationMetricsController],
  providers: [OperationMetricsService, StationEtaService],
})
export class OperationMetricsModule {}
