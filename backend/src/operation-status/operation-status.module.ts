import { Module } from '@nestjs/common';
import { DegradedOperationModule } from '../degraded-operation/degraded-operation.module';
import { OperationStatusController } from './operation-status.controller';
import { OperationStatusService } from './operation-status.service';

@Module({
  imports: [DegradedOperationModule],
  controllers: [OperationStatusController],
  providers: [OperationStatusService],
})
export class OperationStatusModule {}
