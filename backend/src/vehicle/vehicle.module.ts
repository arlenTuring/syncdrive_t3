import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from '../database/entities/vehicle.entity';
import { VehicleController } from './vehicle.controller';
import { VehicleService } from './vehicle.service';
import { RedisModule } from '../redis/redis.module';
import { OperationShiftModule } from '../operation-shift/operation-shift.module';
import { VehicleEtaController } from './eta/vehicle-eta.controller';
import { VehicleEtaService } from './eta/vehicle-eta.service';

@Module({
  // 即時 ETA 的計畫值與班表計畫 ETA 同源，避免兩支對外 API 的計畫時刻出現落差
  imports: [
    RedisModule,
    OperationShiftModule,
    TypeOrmModule.forFeature([Vehicle]),
  ],
  controllers: [VehicleController, VehicleEtaController],
  providers: [VehicleService, VehicleEtaService],
})
export class VehicleModule {}
