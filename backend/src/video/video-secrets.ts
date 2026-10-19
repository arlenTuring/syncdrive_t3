import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 影像來源密碼加密（AES-256-GCM）與短效播放權杖簽章。
 *
 * 金鑰來源：VIDEO_SECRET_KEY（base64 或 hex，32 bytes）；沒設定時（本機開發）自動產生並存在
 * data/.video-secret-key（權限 600，不進 Git）。正式環境由部署設定提供，換金鑰會讓既有密文無法解開。
 */
let cachedKey: Buffer | null = null;

export function videoMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.VIDEO_SECRET_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('VIDEO_SECRET_KEY 必須是 32 bytes（base64 或 64 位 hex）');
    cachedKey = key;
    return key;
  }
  const file = join(process.cwd(), 'data', '.video-secret-key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  cachedKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return cachedKey;
}

const subKey = (purpose: string) => createHmac('sha256', videoMasterKey()).update(`vtms-video:${purpose}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subKey('secret'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(token: string | null | undefined): string | null {
  if (!token) return null;
  const [version, iv, tag, data] = token.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('來源密碼格式不正確');
  const decipher = createDecipheriv('aes-256-gcm', subKey('secret'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** 短效權杖：base64url(JSON).簽章；綁定動作、資源、帳號 Session 與到期 */
export type VideoToken = { kind: 'live' | 'test' | 'playback' | 'export'; sub: string; sid: string; uid: string; exp: number; [key: string]: unknown };

export function signToken(payload: VideoToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', subKey('token')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string, kind: VideoToken['kind'], now = Date.now()): VideoToken | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', subKey('token')).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VideoToken;
    if (payload.kind !== kind || typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
