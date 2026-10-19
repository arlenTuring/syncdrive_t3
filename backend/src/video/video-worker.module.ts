import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from '../access-control/auth.service';
import { VIDEO_ENTITIES } from '../database/entities/video.entities';
import { MediaMtxClient } from './mediamtx.client';
import { VideoArchiveService } from './video-archive.service';
import { VideoConfigService } from './video-config.service';
import { VideoHistoryService } from './video-history.service';
import { VideoReconcilerService } from './video-reconciler.service';
import { VideoStorageService } from './video-storage.service';

/**
 * 媒體 worker（VIDEO_ROLE=worker）：只載入影像相關服務，沒有 HTTP、MQTT、調度引擎。
 *
 * 負責來源設定同步到媒體服務、錄影索引補漏、保存與容量回收、雲端上傳、背景壓縮與下載工作。
 * 與主後端分開執行，轉碼與大量檔案 I/O 不會擠掉 MQTT／車控；資源上限由 compose 設定。
 * 多個 worker 同時存在時，設定同步以資料庫 advisory lock 保證只有一個在做，工作以 SKIP LOCKED 領取。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'syncdrive_user'),
        password: configService.get<string>('DB_PASSWORD', 'syncdrive_password'),
        database: configService.get<string>('DB_NAME', 'syncdrive_t3'),
        entities: [...VIDEO_ENTITIES],
        // worker 只讀寫既有結構，永遠不改資料庫結構
        synchronize: false,
        retryAttempts: 15,
        retryDelay: 2000,
        extra: { max: 4 },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    MediaMtxClient,
    VideoConfigService,
    VideoReconcilerService,
    VideoStorageService,
    VideoHistoryService,
    VideoArchiveService,
    // 播放授權只在 API 程序做；worker 的下載與刪除工作不需要登入狀態
    { provide: AuthService, useValue: {} },
  ],
})
export class VideoWorkerModule {}
