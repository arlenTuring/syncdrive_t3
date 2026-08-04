import { Module } from '@nestjs/common';
import { DevLogController } from './dev-log.controller';

@Module({
  controllers: [DevLogController],
})
export class DevLogModule {}
