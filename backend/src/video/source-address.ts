import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { SourceProtocol } from '../database/entities/video.entities';

/**
 * 影像來源位址：解析、組合、遮蔽與連線範圍檢查（SSRF 防護）。
 *
 * - 使用者可設定區網攝影機，所以不一刀切封鎖私有 IP；改以管理者設定的網段／主機 allowlist 放行。
 * - 一律拒絕 loopback、未指定位址、link-local（含雲端 metadata 169.254.169.254）、多播，及非影像協定（file:、shell 等）。
 * - 檢查時解析 DNS 的每個位址；RTSP／RTMP／SRT 實際連線改用檢查過的 IP，避免 DNS rebinding。
 */
export const PROTOCOLS: readonly SourceProtocol[] = ['rtsp', 'rtsps', 'rtmp', 'rtmps', 'http', 'https', 'srt'];
const DEFAULT_PORT: Record<SourceProtocol, number> = { rtsp: 554, rtsps: 322, rtmp: 1935, rtmps: 443, http: 80, https: 443, srt: 8890 };

export type SourceAddress = {
  protocol: SourceProtocol;
  host: string;
  port: number | null;
  path: string;
  query: string | null;
  username: string | null;
};

const SAFE_PATH = /^[A-Za-z0-9/_\-.~%:@!$&'()*+,;=]*$/;

export function normalizePath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  if (value.length > 500) throw new BadRequestException('路徑最多 500 字');
  const path = value.startsWith('/') ? value : `/${value}`;
  if (!SAFE_PATH.test(path)) throw new BadRequestException('路徑含有不允許的字元');
  if (path.split('/').some((part) => part === '..')) throw new BadRequestException('路徑不能包含 ..');
  return path;
}

export function normalizeHost(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().replace(/^\[(.*)\]$/, '$1');
  if (!value) throw new BadRequestException('請輸入主機');
  if (value.length > 255) throw new BadRequestException('主機名稱太長');
  if (isIP(value)) return value;
  if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$/.test(value)) throw new BadRequestException('主機名稱格式不正確');
  return value.toLowerCase();
}

export function normalizeProtocol(raw: unknown): SourceProtocol {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!(PROTOCOLS as readonly string[]).includes(value)) throw new BadRequestException('不支援的影像協定（可用 RTSP、RTSPS、RTMP、RTMPS、HLS 的 HTTP(S)、SRT）');
  return value as SourceProtocol;
}

export function normalizePort(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('連接埠必須是 1–65535');
  return port;
}

/** 完整 URL 輸入：後端解析並拆出帳密（回傳的位址不含密碼） */
export function parseSourceUrl(raw: string): { address: SourceAddress; password: string | null } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('影像來源網址格式不正確');
  }
  const protocol = normalizeProtocol(url.protocol.replace(/:$/, ''));
  return {
    address: {
      protocol,
      host: normalizeHost(url.hostname),
      port: normalizePort(url.port || null),
      path: normalizePath(decodeURI(url.pathname)),
      query: url.search ? url.search.slice(1).slice(0, 500) : null,
      username: url.username ? decodeURIComponent(url.username) : null,
    },
    password: url.password ? decodeURIComponent(url.password) : null,
  };
}

function hostForUrl(host: string) {
  return isIP(host) === 6 ? `[${host}]` : host;
}

/** 給媒體服務用的完整網址（含帳密；只在後端組出、送給 MediaMTX，不回傳給畫面） */
export function buildSourceUrl(address: SourceAddress, password: string | null, connectHost?: string): string {
  // 只有帳號沒有密碼時要寫成 user:@host（媒體服務不接受只有帳號）
  const auth = address.username ? `${encodeURIComponent(address.username)}:${password ? encodeURIComponent(password) : ''}@` : '';
  const port = address.port ? `:${address.port}` : '';
  const query = address.query ? `?${address.query}` : '';
  return `${address.protocol}://${auth}${hostForUrl(connectHost ?? address.host)}${port}${address.path || ''}${query}`;
}

/** 畫面與稽核用：不含密碼 */
export function maskedSourceUrl(address: SourceAddress, hasPassword: boolean): string {
  const auth = address.username ? `${address.username}${hasPassword ? ':***' : ''}@` : '';
  const port = address.port ? `:${address.port}` : '';
  return `${address.protocol}://${auth}${hostForUrl(address.host)}${port}${address.path || ''}${address.query ? '?…' : ''}`;
}

export function defaultPort(protocol: SourceProtocol) {
  return DEFAULT_PORT[protocol];
}

const FORBIDDEN = new BlockList();
FORBIDDEN.addSubnet('0.0.0.0', 8, 'ipv4');
FORBIDDEN.addSubnet('127.0.0.0', 8, 'ipv4');
FORBIDDEN.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local，含雲端 metadata
FORBIDDEN.addSubnet('224.0.0.0', 4, 'ipv4');
FORBIDDEN.addSubnet('240.0.0.0', 4, 'ipv4');
FORBIDDEN.addAddress('::', 'ipv6');
FORBIDDEN.addAddress('::1', 'ipv6');
FORBIDDEN.addSubnet('fe80::', 10, 'ipv6');
FORBIDDEN.addSubnet('ff00::', 8, 'ipv6');
const FORBIDDEN_NAMES = ['localhost', 'metadata', 'metadata.google.internal', 'metadata.goog'];

function mapped(address: string) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return m ? m[1] : address;
}

export function validateAllowlistEntry(entry: string): string {
  const value = entry.trim();
  const cidr = /^([^/]+)\/(\d{1,3})$/.exec(value);
  if (cidr) {
    const family = isIP(cidr[1]);
    const bits = Number(cidr[2]);
    if (!family || bits > (family === 4 ? 32 : 128)) throw new BadRequestException(`網段格式不正確：${value}`);
    return value;
  }
  if (isIP(value)) return value;
  return normalizeHost(value);
}

export type HostCheck = { ok: true; addresses: string[] } | { ok: false; reason: string };

/** 主機是否在允許範圍：每個解析出的位址都必須不在禁止範圍，且至少符合一筆 allowlist（網段或主機名稱） */
export async function checkHostAllowed(host: string, allowlist: string[], resolver: (h: string) => Promise<string[]> = defaultResolve): Promise<HostCheck> {
  const name = host.toLowerCase();
  if (FORBIDDEN_NAMES.includes(name) || name.endsWith('.localhost')) return { ok: false, reason: '不允許連線到本機或雲端 metadata 位址' };
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolver(host);
  } catch {
    return { ok: false, reason: '無法解析主機名稱' };
  }
  if (!addresses.length) return { ok: false, reason: '無法解析主機名稱' };
  const allowed = new BlockList();
  const names = new Set<string>();
  for (const entry of allowlist) {
    const cidr = /^([^/]+)\/(\d{1,3})$/.exec(entry);
    if (cidr) allowed.addSubnet(cidr[1], Number(cidr[2]), isIP(cidr[1]) === 6 ? 'ipv6' : 'ipv4');
    else if (isIP(entry)) allowed.addAddress(entry, isIP(entry) === 6 ? 'ipv6' : 'ipv4');
    else names.add(entry.toLowerCase());
  }
  for (const raw of addresses) {
    const address = mapped(raw);
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (FORBIDDEN.check(address, family)) return { ok: false, reason: '不允許連線到本機、link-local 或雲端 metadata 位址' };
    if (!names.has(name) && !allowed.check(address, family)) return { ok: false, reason: `位址 ${address} 不在允許的攝影機網段內，請聯絡系統管理者調整部署端影像連線政策` };
  }
  return { ok: true, addresses: addresses.map(mapped) };
}

async function defaultResolve(host: string) {
  const result = await lookup(host, { all: true, verbatim: true });
  return result.map((r) => r.address);
}
