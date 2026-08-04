import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryItem } from '../database/entities/media-library-item.entity';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibrarySeedService } from './media-library-seed.service';
import { MediaLibraryService } from './media-library.service';

@Module({
  imports: [TypeOrmModule.forFeature([MediaLibraryItem])],
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService, MediaLibrarySeedService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
