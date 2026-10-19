import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { MediaMtxClient } from './mediamtx.client';
import { VideoConfigService } from './video-config.service';
import { VideoController, VideoLiveProxyController } from './video.controller';
import { VideoLiveService } from './video-live.service';
import { VideoReconcilerService } from './video-reconciler.service';

/** 影像監控與歷史錄影 */
@Module({
  imports: [AccessControlModule],
  controllers: [VideoController, VideoLiveProxyController],
  providers: [MediaMtxClient, VideoConfigService, VideoLiveService, VideoReconcilerService],
  exports: [VideoConfigService, MediaMtxClient],
})
export class VideoModule {}
