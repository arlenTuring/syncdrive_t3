/**
 * 產出兩份 OpenAPI 檔案，不需要對外開埠。
 *
 *   npm run openapi:export        → backend/openapi/openapi.internal.json
 *                                   backend/openapi/openapi.public.json
 *
 * 對外那一份就是交付給協力廠商的檔案：可以直接匯進 Postman、產 client，
 * 不必連到我方主機。內部那一份留著自己對照與做差異比較。
 *
 * 需要與啟動伺服器相同的環境（資料庫、Redis 連線設定）——建立 Nest 應用程式時
 * 各模組會初始化。腳本只 init 不 listen，跑完立刻關閉。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  buildInternalDocument,
  buildPublicDocument,
} from './common/openapi-documents';

function countOperations(document: {
  paths?: Record<string, unknown>;
}): number {
  let total = 0;
  for (const item of Object.values(document.paths ?? {})) {
    total += Object.keys(item as Record<string, unknown>).length;
  }
  return total;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();

  // 用 __dirname 而不是 cwd：輸出位置是原始碼結構的屬性，與從哪裡啟動無關
  // dist/openapi-export.js 與 src/openapi-export.ts 都在 backend/ 底下一層
  const outDir = resolve(__dirname, '..', 'openapi');
  mkdirSync(outDir, { recursive: true });

  const internal = buildInternalDocument(app);
  const publicDoc = buildPublicDocument(app);

  const files: Array<[string, unknown, number]> = [
    ['openapi.internal.json', internal, countOperations(internal)],
    ['openapi.public.json', publicDoc, countOperations(publicDoc)],
  ];
  for (const [name, document, count] of files) {
    const target = resolve(outDir, name);
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    console.log(`${name}  ${count} 個操作  →  ${target}`);
  }

  if (countOperations(publicDoc) === 0) {
    console.warn(
      '對外文件是空的——沒有任何端點掛 @ExternalApi()。交付之前請確認這是預期結果。',
    );
  }

  await app.close();
  /**
   * 明確結束行程。
   *
   * <code>app.close()</code> 不保證事件迴圈清空——MQTT 客戶端與 Redis 連線會把它
   * 撐著，腳本就停在那裡不退出（實測：檔案已寫出，行程仍在跑）。這支是一次性
   * 匯出工具，寫完就該結束。
   */
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
