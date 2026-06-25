import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommandLog } from '../database/entities/command-log.entity';
import { CommandService } from './command.service';
import { CommandController } from './command.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([CommandLog]), AuditModule],
  providers: [CommandService],
  controllers: [CommandController],
  exports: [CommandService],
})
export class CommandModule {}
