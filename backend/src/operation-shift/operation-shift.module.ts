import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationShift } from '../database/entities/operation-shift.entity';
import { MapModule } from '../map/map.module';
import { OperationShiftController } from './operation-shift.controller';
import { OperationShiftSeedService } from './operation-shift-seed.service';
import { OperationShiftService } from './operation-shift.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationShift]), MapModule],
  controllers: [OperationShiftController],
  providers: [OperationShiftService, OperationShiftSeedService],
  exports: [OperationShiftService],
})
export class OperationShiftModule {}
