import { Module } from '@nestjs/common';
import { VehicleController } from './vehicle.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [VehicleController],
})
export class VehicleModule {}
