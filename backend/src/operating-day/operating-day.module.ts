import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { OperatingClockService } from './operating-clock.service';

/** 營運時鐘全系統共用：訂單生命週期、班次中心、ETA 都要它 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting])],
  providers: [OperatingClockService],
  exports: [OperatingClockService],
})
export class OperatingDayModule {}
