import { createReadStream } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

/**
 * Google Cloud Storage（JSON API）最小客戶端。憑證用部署主機的服務身分（GCE metadata server），
 * 不需要也不接受貼上 service-account 私鑰。物件不覆寫（ifGenerationMatch=0），重試冪等。
 */
export class GcsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let token: { value: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: controller.signal });
    if (!res.ok) throw new GcsError(`無法取得 GCP 服務身分權杖（${res.status}）`, 503);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
    return token.value;
  } catch (error) {
    if (error instanceof GcsError) throw error;
    throw new GcsError('無法取得 GCP 服務身分（只有部署在 GCP 主機上才能使用 GCS）', 503);
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

/** 上傳檔案（串流，不整檔讀進記憶體）；回傳 generation 與 md5 供驗證 */
export async function uploadFile(bucket: string, name: string, file: string, size: number): Promise<{ generation: string; md5Hash: string; size: number }> {
  const auth = await accessToken();
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      `https://storage.googleapis.com/upload/storage/v1/b/${enc(bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${enc(name)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, timeout: 300_000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 412) return reject(new GcsError('雲端已有同名物件（不覆寫）', 412));
          if ((res.statusCode ?? 500) >= 300) return reject(new GcsError(`GCS 上傳失敗（${res.statusCode}）：${body.slice(0, 200)}`, res.statusCode ?? 500));
          const meta = JSON.parse(body) as { generation: string; md5Hash: string; size: string };
          resolve({ generation: meta.generation, md5Hash: meta.md5Hash, size: Number(meta.size) });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('GCS 上傳逾時')));
    req.on('error', reject);
    createReadStream(file).on('error', reject).pipe(req);
  });
}

export async function objectMeta(bucket: string, name: string): Promise<{ generation: string; md5Hash: string; size: string } | null> {
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${enc(bucket)}/o/${enc(name)}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new GcsError(`GCS 查詢失敗（${res.status}）`, res.status);
  return (await res.json()) as { generation: string; md5Hash: string; size: string };
}

export async function deleteObject(bucket: string, name: string, generation?: string | null) {
  const query = generation ? `?ifGenerationMatch=${enc(generation)}` : '';
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${enc(bucket)}/o/${enc(name)}${query}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 404 || res.status === 204 || res.ok) return;
  throw new GcsError(`GCS 刪除失敗（${res.status}）`, res.status);
}

/** 讀取物件（支援 Range），回傳可直接 pipe 給瀏覽器的串流 */
export async function readObject(bucket: string, name: string, range?: string): Promise<{ status: number; headers: Headers; body: Readable }> {
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${enc(bucket)}/o/${enc(name)}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken()}`, ...(range ? { Range: range } : {}) } });
  if (!res.ok && res.status !== 206) throw new GcsError(`GCS 讀取失敗（${res.status}）`, res.status);
  return { status: res.status, headers: res.headers, body: Readable.fromWeb(res.body as never) };
}

/** bucket 的保護政策（soft delete、版本），設定頁顯示「應用已移除但雲端仍保留」 */
export async function bucketPolicy(bucket: string) {
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${enc(bucket)}?fields=softDeletePolicy,versioning,lifecycle,storageClass`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new GcsError(`無法讀取 bucket 設定（${res.status}）`, res.status);
  return (await res.json()) as { softDeletePolicy?: { retentionDurationSeconds?: string }; versioning?: { enabled?: boolean }; storageClass?: string; lifecycle?: unknown };
}
