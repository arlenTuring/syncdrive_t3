import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { SystemHealthModule } from '../system-health/system-health.module';
import { VideoArchiveService } from './video-archive.service';
import { MediaMtxClient } from './mediamtx.client';
import { VideoConfigService } from './video-config.service';
import { VideoController, VideoLiveProxyController, VideoMediaController } from './video.controller';
import { VideoHistoryService } from './video-history.service';
import { VideoStorageService } from './video-storage.service';
import { VideoLiveService } from './video-live.service';
import { VideoReconcilerService } from './video-reconciler.service';

/** 影像監控與歷史錄影 */
@Module({
  imports: [AccessControlModule, SystemHealthModule],
  controllers: [VideoController, VideoLiveProxyController, VideoMediaController],
  providers: [MediaMtxClient, VideoConfigService, VideoLiveService, VideoReconcilerService, VideoStorageService, VideoHistoryService, VideoArchiveService],
  exports: [VideoConfigService, MediaMtxClient, VideoHistoryService],
})
export class VideoModule {}
