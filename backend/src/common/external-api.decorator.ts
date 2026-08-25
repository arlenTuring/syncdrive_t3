import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from './api-key.guard';

/**
 * 對外端點標記。
 *
 * 這個系統的 API 有兩種讀者：協力廠商（中心端、IOT SCADA、站顯）與我方前端。
 * 兩者的差別不只是「文件要不要給」——給了 base URL，對方就能自己猜路徑打進來。
 * 所以標記同時管三件事，讓「文件上看得到的」與「網路上打得到的」永遠是同一份：
 *
 * <ol>
 *   <li><strong>文件</strong>：{@link EXTERNAL_API_METADATA_KEY} 供 OpenAPI 產生時
 *       過濾，只有標記過的端點會出現在對外那份文件裡。</li>
 *   <li><strong>網路</strong>：對外 port 上的守衛只放行標記過的路由，其餘一律 404
 *       （見 <code>external-port.guard.ts</code>）。</li>
 *   <li><strong>身分</strong>：掛上 {@link ApiKeyGuard}，並在 Swagger 標明需要
 *       <code>x-api-key</code>——車輛即時 ETA 規格書第二章明訂此標頭。</li>
 * </ol>
 *
 * 沒有標記的端點是內部端點，不需要任何額外裝飾——預設就是對內。
 */
export const EXTERNAL_API_METADATA_KEY = 'syncdrive:external-api';

/** 對外文件裡的分組前綴，讓廠商一眼看出這是對外契約 */
export const EXTERNAL_API_TAG_PREFIX = '對外';

export function ExternalApi(tag: string): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(EXTERNAL_API_METADATA_KEY, true),
    ApiTags(`${EXTERNAL_API_TAG_PREFIX}｜${tag}`),
    ApiSecurity('x-api-key'),
    ApiUnauthorizedResponse({
      description: '缺少或不正確的 x-api-key 標頭',
    }),
    UseGuards(ApiKeyGuard),
  );
}
