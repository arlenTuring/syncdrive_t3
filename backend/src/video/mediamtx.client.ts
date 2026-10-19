import { Injectable, Logger } from '@nestjs/common';
import { videoConfig } from './video.config';

/** MediaMTX 路徑設定中由本系統管理的欄位 */
export type ManagedPathConfig = {
  source: string;
  sourceOnDemand: boolean;
  record: boolean;
  recordPath: string;
  recordFormat: 'fmp4';
  recordSegmentDuration: string;
  recordPartDuration: string;
  recordDeleteAfter: string;
  rtspTransport: string;
  useAbsoluteTimestamp: boolean;
};

export type RuntimePath = {
  name: string;
  ready: boolean;
  readyTime: string | null;
  tracks: string[];
  bytesReceived: number;
  readers: unknown[];
  source: { type: string; id: string } | null;
};

export class MediaServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * MediaMTX Control API（v3，已對 1.21.2 實測）與播放伺服器的最小客戶端。
 * 帳密來自部署設定；所有呼叫有逾時，媒體服務不在時回 MediaServiceError，不拖垮主程式。
 */
@Injectable()
export class MediaMtxClient {
  private readonly logger = new Logger(MediaMtxClient.name);

  private auth() {
    const { user, password } = videoConfig();
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }

  private async call<T>(base: string, path: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: this.auth(), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      });
      const text = await response.text();
      if (!response.ok) throw new MediaServiceError(`媒體服務回應 ${response.status}：${text.slice(0, 200)}`, response.status);
      return (text ? JSON.parse(text) : {}) as T;
    } catch (error) {
      if (error instanceof MediaServiceError) throw error;
      throw new MediaServiceError(`媒體服務無法連線：${(error as Error).message}`, 503);
    } finally {
      clearTimeout(timer);
    }
  }

  private api<T>(path: string, init?: RequestInit) {
    return this.call<T>(videoConfig().apiUrl, path, init);
  }

  async listConfigPaths(): Promise<Array<{ name: string } & Partial<ManagedPathConfig>>> {
    const out: Array<{ name: string } & Partial<ManagedPathConfig>> = [];
    for (let page = 0; page < 50; page += 1) {
      const res = await this.api<{ pageCount: number; items: Array<{ name: string } & Partial<ManagedPathConfig>> }>(`/v3/config/paths/list?itemsPerPage=200&page=${page}`);
      out.push(...res.items);
      if (page + 1 >= res.pageCount) break;
    }
    return out;
  }

  addPath(name: string, config: Partial<ManagedPathConfig>) {
    return this.api(`/v3/config/paths/add/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(config) });
  }

  patchPath(name: string, config: Partial<ManagedPathConfig>) {
    return this.api(`/v3/config/paths/patch/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(config) });
  }

  async deletePath(name: string) {
    try {
      await this.api(`/v3/config/paths/delete/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch (error) {
      if (error instanceof MediaServiceError && error.status === 404) return;
      throw error;
    }
  }

  async listRuntimePaths(): Promise<RuntimePath[]> {
    const out: RuntimePath[] = [];
    for (let page = 0; page < 50; page += 1) {
      const res = await this.api<{ pageCount: number; items: RuntimePath[] }>(`/v3/paths/list?itemsPerPage=200&page=${page}`);
      out.push(...res.items);
      if (page + 1 >= res.pageCount) break;
    }
    return out;
  }

  async getRuntimePath(name: string): Promise<RuntimePath | null> {
    try {
      return await this.api<RuntimePath>(`/v3/paths/get/${encodeURIComponent(name)}`);
    } catch (error) {
      if (error instanceof MediaServiceError && error.status === 404) return null;
      throw error;
    }
  }

  /** 播放伺服器：某路徑在區間內的錄影（相鄰片段會合併成一段） */
  async listRecordingSpans(path: string, from?: Date, to?: Date): Promise<Array<{ start: string; duration: number }>> {
    const query = new URLSearchParams({ path });
    if (from) query.set('start', from.toISOString());
    if (to) query.set('end', to.toISOString());
    try {
      return await this.call<Array<{ start: string; duration: number }>>(videoConfig().playbackUrl, `/list?${query}`);
    } catch (error) {
      if (error instanceof MediaServiceError && error.status === 404) return [];
      throw error;
    }
  }

  /** 健康檢查：媒體服務可用與版本 */
  async info(): Promise<{ version?: string } | null> {
    try {
      return await this.api<{ version?: string }>('/v3/info');
    } catch (error) {
      this.logger.debug(`media info failed: ${(error as Error).message}`);
      return null;
    }
  }
}
