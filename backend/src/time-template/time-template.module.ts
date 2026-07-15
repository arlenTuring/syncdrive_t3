import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeTemplate } from '../database/entities/time-template.entity';
import { TimeTemplateController } from './time-template.controller';
import { TimeTemplateSeedService } from './time-template-seed.service';
import { TimeTemplateService } from './time-template.service';

@Module({
  imports: [TypeOrmModule.forFeature([TimeTemplate])],
  controllers: [TimeTemplateController],
  providers: [TimeTemplateService, TimeTemplateSeedService],
  exports: [TimeTemplateService],
})
export class TimeTemplateModule {}
