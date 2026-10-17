import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryItem } from '../database/entities/media-library-item.entity';
import { MediaSchedule } from '../database/entities/media-schedule.entity';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([MediaLibraryItem, MediaSchedule])],
  controllers: [MediaLibraryController],
  // Demo seed 不在啟動時自動執行；否則使用者刪光後重啟會把範例資料復活。
  providers: [MediaLibraryService, MediaStorageService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
