import { NestFactory, Reflector } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, type LogLevel } from '@nestjs/common';
import { createServer } from 'node:http';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { ExternalPortGuard } from './common/external-port.guard';
import {
  buildInternalDocument,
  buildPublicDocument,
} from './common/openapi-documents';

/** 解析 CORS 允許來源；留空或 '*' 代表全部放行（僅開發用）。 */
function resolveCorsOrigin(): string | string[] | boolean {
  const raw = (process.env.CORS_ORIGIN ?? '*').trim();
  if (raw === '' || raw === '*') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

  /*
   * 信任前面那一層 nginx 送來的 X-Forwarded-For。
   *
   * 不設的話 request.ip 拿到的是 nginx 容器在 docker 網路裡的位址（172.18.0.x），
   * 對每一個請求都一樣。發放金鑰時記的來源 IP 因此永遠是同一個值，稽核欄位等於
   * 沒有作用——出事時查不到是誰在什麼位置拿走了金鑰。
   *
   * 只信任一層：後端沒有對主機發布任何埠，唯一進得來的路徑就是 nginx，所以
   * 鏈上只會有它。設成 true（信任全部）的話，外部就能自己偽造整條 X-Forwarded-For
   * 把來源 IP 寫成任何值。
   */
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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

  // 對外 port 的路由圍籬：從那個 port 進來、卻不是對外端點的請求一律 404
  app.useGlobalGuards(new ExternalPortGuard(app.get(Reflector)));

  /**
   * 對外 port 上把內部那份文件擋掉。
   *
   * {@link ExternalPortGuard} 管不到這裡——Swagger UI 是 express middleware，
   * 不是 Nest 路由處理器，守衛不會跑到。少了這一段，廠商連上對外 port 打開
   * <code>/api/docs</code> 就會看到全部 79 支端點，等於分兩份文件白做。
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    const externalPort = Number(process.env.EXTERNAL_PORT ?? 0);
    if (!externalPort || req.socket?.localPort !== externalPort) return next();
    const path = req.path || req.url || '';
    if (!path.startsWith('/api/docs')) return next();
    // 對外那份與它的靜態資源照常放行，其餘 /api/docs* 一律當作不存在
    if (path.startsWith('/api/docs/public')) return next();
    res.status(404).json({ statusCode: 404, message: 'Not Found' });
  });

  // 1. 設定 Swagger API 文件
  //
  // 兩份：內部（全部端點）與對外（只有掛 @ExternalApi 的）。交付給協力廠商的是
  // 後者，而且對外 port 上只掛得到後者——見下方 listen 與 ExternalPortGuard。
  const internalDocument = buildInternalDocument(app);
  const publicDocument = buildPublicDocument(app);
  SwaggerModule.setup('api/docs', app, internalDocument);
  SwaggerModule.setup('api/docs/public', app, publicDocument);

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

  /**
   * 對外 port：同一份路由表再聽一個 port，交給協力廠商。
   *
   * 用同一個 express 實例而不是另外開一個應用程式——服務、資料庫連線、MQTT
   * 全部共用一份，不必為了分流把模組拆兩套。隔離由 {@link ExternalPortGuard}
   * 依連線的 localPort 判定；正式部署再加上防火牆只對外開這一個 port。
   *
   * 未設定 EXTERNAL_PORT 就不開，行為與加這段之前完全一樣。
   */
  const externalPort = Number(process.env.EXTERNAL_PORT ?? 0);
  if (Number.isInteger(externalPort) && externalPort > 0) {
    if (externalPort === port) {
      throw new Error(
        `EXTERNAL_PORT (${externalPort}) 不可與 PORT 相同——那等於沒有隔離。`,
      );
    }
    const externalServer = createServer(
      app.getHttpAdapter().getInstance() as never,
    );
    await new Promise<void>((resolve) => {
      externalServer.listen(externalPort, '0.0.0.0', resolve);
    });
    console.log(
      `External API is running on: http://127.0.0.1:${externalPort}` +
        ` (docs: http://127.0.0.1:${externalPort}/api/docs/public)`,
    );
  }
}
bootstrap();
