import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DegradedOperationPlan } from '../database/entities/degraded-operation-plan.entity';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import { DegradedOperationEvent } from '../database/entities/degraded-operation-event.entity';
import { DegradedOperationDraft } from '../database/entities/degraded-operation-draft.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { SystemHealthModule } from '../system-health/system-health.module';
import { DegradedOperationController } from './degraded-operation.controller';
import { DegradedOperationService } from './degraded-operation.service';

@Module({
  imports: [
    SystemHealthModule,
    TypeOrmModule.forFeature([
      DegradedOperationPlan,
      DegradedOperationExecution,
      DegradedOperationEvent,
      DegradedOperationDraft,
      SystemSetting,
    ]),
  ],
  controllers: [DegradedOperationController],
  providers: [DegradedOperationService],
})
export class DegradedOperationModule {}
