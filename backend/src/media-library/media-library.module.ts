import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryItem } from '../database/entities/media-library-item.entity';
import { MediaSchedule } from '../database/entities/media-schedule.entity';
import { MediaPlayBatch, MediaPlayDelivery, MediaPlaySchedule, MediaPlayScheduleItem } from '../database/entities/media-play-schedule.entities';
import { SystemHealthModule } from '../system-health/system-health.module';
import { MediaPlayDispatcherService } from './media-play-dispatcher.service';
import { MediaPlaySchedulesController } from './media-play-schedules.controller';
import { MediaPlaySchedulesService } from './media-play-schedules.service';
import { MediaGroupsController } from './media-groups.controller';
import { MediaGroupsService } from './media-groups.service';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([MediaLibraryItem, MediaSchedule, MediaPlaySchedule, MediaPlayScheduleItem, MediaPlayBatch, MediaPlayDelivery]), SystemHealthModule],
  controllers: [MediaLibraryController, MediaGroupsController, MediaPlaySchedulesController],
  // Demo seed 不在啟動時自動執行；否則使用者刪光後重啟會把範例資料復活。
  providers: [MediaLibraryService, MediaGroupsService, MediaStorageService, MediaPlaySchedulesService, MediaPlayDispatcherService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
