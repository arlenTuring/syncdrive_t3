import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

/** components.schemas 的值型別；@nestjs/swagger 沒有把它單獨匯出 */
type SchemaEntry = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>[string];
import { EXTERNAL_API_TAG_PREFIX } from './external-api.decorator';

/** 只取用得到的欄位；OpenAPI 操作物件其餘欄位原樣搬運，不需要型別 */
type OperationLike = { tags?: string[] } & Record<string, unknown>;

/** OpenAPI 裡代表一個 HTTP 方法的鍵；其餘（如 parameters、summary）不是操作 */
const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

function baseBuilder(): DocumentBuilder {
  return new DocumentBuilder()
    .setVersion(process.env.API_VERSION ?? '1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      'x-api-key',
    );
}

/** 內部文件：全部端點都在，給我方前端與後台開發使用 */
export function buildInternalDocument(app: INestApplication): OpenAPIObject {
  const config = baseBuilder()
    .setTitle('SyncDrive-T3 API（內部）')
    .setDescription(
      '我方前端、後台與維運使用的完整介面。**這一份不對外發布**——' +
        '交付給協力廠商的是對外文件（見 /api/docs/public）。',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * 對外文件：只保留掛了 <code>@ExternalApi()</code> 的端點。
 *
 * 從內部文件<strong>過濾</strong>而不是另外產生，是為了讓兩份文件對同一支端點的
 * 描述永遠一致——重複定義遲早會分岔，而分岔的那一份就是廠商拿到的那一份。
 */
export function buildPublicDocument(app: INestApplication): OpenAPIObject {
  return filterExternalDocument(buildInternalDocument(app));
}

/**
 * 過濾本體，與 Nest 無關，可單獨測試。
 *
 * 分出來是因為這一段是<strong>安全邊界</strong>：漏過濾就是把內部端點交出去。
 * 綁在 <code>INestApplication</code> 上的話，要驗證它就得起整個應用程式（連資料庫、
 * Redis、MQTT），沒有人會為了改一行過濾邏輯去跑那個。
 */
export function filterExternalDocument(full: OpenAPIObject): OpenAPIObject {
  const config = baseBuilder()
    .setTitle('SyncDrive-T3 對外介面')
    .setDescription(
      '台智駕 SyncDrive T3 車輛監控系統對外提供的介面契約。所有端點需帶 ' +
        '`x-api-key` 標頭。詳細語意見各端點說明與規格書。',
    )
    .build();

  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(full.paths ?? {})) {
    const kept: Record<string, unknown> = {};
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, OperationLike | undefined>)[
        method
      ];
      if (!operation) continue;
      const tags = operation.tags ?? [];
      const externalTags = tags.filter((tag) =>
        tag.startsWith(EXTERNAL_API_TAG_PREFIX),
      );
      if (externalTags.length === 0) continue;
      // 內部分組名（controller 的 @ApiTags）不帶進對外文件——那是我方的模組劃分，
      // 留著只會讓廠商看到不存在於對外契約裡的分類，還洩漏內部結構
      kept[method] = { ...operation, tags: externalTags };
    }
    if (Object.keys(kept).length > 0) {
      paths[path] = kept;
    }
  }

  return {
    ...full,
    ...config,
    paths,
    tags: (full.tags ?? []).filter((tag) =>
      tag.name.startsWith(EXTERNAL_API_TAG_PREFIX),
    ),
    components: {
      ...full.components,
      schemas: pruneSchemas(full, paths),
    },
  };
}

/**
 * 只留下對外路徑真的參照得到的 schema。
 *
 * 不剪的話，對外文件的 <code>components.schemas</code> 會含著整個內部資料模型
 * ——端點藏起來了，資料結構卻照樣攤在廠商眼前。從對外路徑出發做可達性收集，
 * 沿 <code>$ref</code> 一路展開到不動點。
 */
function pruneSchemas(
  full: OpenAPIObject,
  paths: OpenAPIObject['paths'],
): Record<string, SchemaEntry> {
  const all = full.components?.schemas ?? {};
  const reachable = new Set<string>();

  const visit = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.split('/').pop();
        if (name && all[name] && !reachable.has(name)) {
          reachable.add(name);
          visit(all[name]);
        }
        continue;
      }
      visit(value);
    }
  };

  visit(paths);
  const kept: Record<string, SchemaEntry> = {};
  for (const name of [...reachable].sort()) kept[name] = all[name];
  return kept;
}
