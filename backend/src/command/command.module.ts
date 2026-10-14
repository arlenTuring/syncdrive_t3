import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { CommandService } from './command.service';
import { CommandController } from './command.controller';
import { AuditModule } from '../audit/audit.module';
import { Vehicle } from '../database/entities/vehicle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CommandLog, Vehicle]), AuditModule],
  providers: [CommandService],
  controllers: [CommandController],
  exports: [CommandService],
})
export class CommandModule {}
