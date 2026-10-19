import { Module } from '@nestjs/common';
import { SystemHealthModule } from '../system-health/system-health.module';
import { EventsController, VideoController } from './events.controller';
import { EventsService } from './events.service';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { VideoService } from './video.service';

/** 事件管理模組與日誌管理模組的後端（共用時間、匯出與查詢驗證） */
@Module({
  imports: [SystemHealthModule],
  controllers: [EventsController, VideoController, LogsController],
  providers: [EventsService, LogsService, VideoService],
})
export class EventLogModule {}
