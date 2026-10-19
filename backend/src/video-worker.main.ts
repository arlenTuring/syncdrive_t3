import { NestFactory } from '@nestjs/core';
import type { LogLevel } from '@nestjs/common';
import { VideoWorkerModule } from './video/video-worker.module';

/** 媒體 worker 進入點：node dist/video-worker.main.js（VIDEO_ROLE 固定為 worker） */
async function bootstrap() {
  process.env.VIDEO_ROLE = 'worker';
  const raw = (process.env.LOG_LEVEL ?? 'warn').toLowerCase();
  const logger: LogLevel[] = raw === 'error' ? ['error'] : raw === 'warn' ? ['error', 'warn'] : ['error', 'warn', 'log'];
  const app = await NestFactory.createApplicationContext(VideoWorkerModule, { logger });
  app.enableShutdownHooks();
}

void bootstrap();
