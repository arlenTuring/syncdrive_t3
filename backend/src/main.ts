import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, type LogLevel } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

/** 解析 CORS 允許來源；留空或 '*' 代表全部放行（僅開發用）。 */
function resolveCorsOrigin(): string | string[] | boolean {
  const raw = (process.env.CORS_ORIGIN ?? '*').trim();
  if (raw === '' || raw === '*') return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveNestLogLevels(): LogLevel[] {
  const raw = (process.env.LOG_LEVEL ?? 'warn').toLowerCase();
  if (raw === 'silent' || raw === 'error') return ['error'];
  if (raw === 'warn') return ['error', 'warn'];
  if (raw === 'log' || raw === 'info') return ['error', 'warn', 'log'];
  return ['error', 'warn', 'log', 'debug', 'verbose'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: resolveNestLogLevels(),
  });

  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '10mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // 啟用 CORS（來源由 CORS_ORIGIN 控制，預設開發全開）
  app.enableCors({ origin: resolveCorsOrigin() });

  // 全域請求驗證：transform 將 plain object 轉為 DTO 實例並對有 class-validator
  // 裝飾的 DTO 執行驗證。此處刻意「不」全域啟用 whitelist/forbidNonWhitelisted，
  // 以免衝擊尚未加裝飾子的既有 DTO（如 demo 模擬端點）。需要嚴格白名單的安全端點
  // （如 command/execute）於 controller 層自行套用更嚴格的 ValidationPipe。
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // 1. 設定 Swagger API 文件
  const config = new DocumentBuilder()
    .setTitle('SyncDrive-T3 API')
    .setDescription('The SyncDrive-T3 Backend REST API')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 2. 設定 MQTT Microservice 接收端
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
      // QoS 1（at-least-once）：確保安全關鍵訊息（指令 Ack、事件上報）不被靜默丟棄
      subscribeOptions: { qos: 1 },
    },
  });

  await app.startAllMicroservices();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://127.0.0.1:${port}`);
  console.log(`Swagger docs are available at: ${await app.getUrl()}/api/docs`);
}
bootstrap();
