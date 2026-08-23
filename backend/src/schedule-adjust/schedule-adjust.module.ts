import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleAdjustRequest } from '../database/entities/schedule-adjust-request.entity';
import { ScheduleAdjustController } from './schedule-adjust.controller';
import { ScheduleAdjustService } from './schedule-adjust.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduleAdjustRequest])],
  controllers: [ScheduleAdjustController],
  providers: [ScheduleAdjustService],
  exports: [ScheduleAdjustService],
})
export class ScheduleAdjustModule {}
