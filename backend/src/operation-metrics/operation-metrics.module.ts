import { Module } from '@nestjs/common';
import { FacilityModule } from '../facility/facility.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { TimeTemplateModule } from '../time-template/time-template.module';
import { OperationMetricsController } from './operation-metrics.controller';
import { OperationMetricsService } from './operation-metrics.service';

@Module({
  imports: [OperationShiftModule, TimeTemplateModule, FacilityModule, DispatchModule],
  controllers: [OperationMetricsController],
  providers: [OperationMetricsService],
})
export class OperationMetricsModule {}
