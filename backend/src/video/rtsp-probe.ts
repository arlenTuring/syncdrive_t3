import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * RTSP 連線診斷：直接送 DESCRIBE（必要時 Basic／Digest 認證），把失敗原因轉成使用者看得懂的訊息。
 * 只做診斷；真正的接入與預覽交給媒體服務。連線目標必須先通過連線範圍檢查。
 */
export type ProbeResult = { ok: true; status: number } | { ok: false; code: 'TIMEOUT' | 'REFUSED' | 'AUTH' | 'NOT_FOUND' | 'PROTOCOL' | 'UNREACHABLE'; message: string };

const MESSAGES: Record<Exclude<ProbeResult, { ok: true }>['code'], string> = {
  TIMEOUT: '連線逾時：請確認主機、連接埠與網路是否可到達',
  REFUSED: '連線被拒絕：主機有回應，但這個連接埠沒有影像服務',
  AUTH: '帳號或密碼錯誤',
  NOT_FOUND: '路徑不存在：請確認影像路徑',
  PROTOCOL: '來源回應的不是 RTSP 影像服務',
  UNREACHABLE: '無法連線到來源主機',
};

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function request(host: string, port: number, tls: boolean, lines: string[], timeoutMs: number): Promise<{ status: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const socket: Socket | TLSSocket = tls ? tlsConnect({ host, port, rejectUnauthorized: false, servername: undefined }) : new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    socket.on('error', (err) => done(() => reject(err)));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const [first, ...rest] = buffer.slice(0, end).split('\r\n');
      const m = /^RTSP\/1\.\d (\d{3})/.exec(first);
      if (!m) return done(() => reject(Object.assign(new Error('protocol'), { code: 'EPROTO_RTSP' })));
      const headers: Record<string, string> = {};
      for (const line of rest) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      done(() => resolve({ status: Number(m[1]), headers }));
    });
    const send = () => socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (tls) (socket as TLSSocket).once('secureConnect', send);
    else (socket as Socket).connect(port, host, send);
  });
}

export async function probeRtsp(input: { host: string; port: number; tls: boolean; url: string; username: string | null; password: string | null }, timeoutMs = 4_000): Promise<ProbeResult> {
  const base = [`DESCRIBE ${input.url} RTSP/1.0`, 'CSeq: 1', 'Accept: application/sdp', 'User-Agent: VTMS-probe'];
  try {
    let res = await request(input.host, input.port, input.tls, base, timeoutMs);
    if (res.status === 401 && input.username) {
      const challenge = res.headers['www-authenticate'] ?? '';
      let auth: string;
      if (/^digest/i.test(challenge)) {
        const realm = /realm="([^"]*)"/i.exec(challenge)?.[1] ?? '';
        const nonce = /nonce="([^"]*)"/i.exec(challenge)?.[1] ?? '';
        const ha1 = md5(`${input.username}:${realm}:${input.password ?? ''}`);
        const ha2 = md5(`DESCRIBE:${input.url}`);
        auth = `Digest username="${input.username}", realm="${realm}", nonce="${nonce}", uri="${input.url}", response="${md5(`${ha1}:${nonce}:${ha2}`)}"`;
      } else {
        auth = `Basic ${Buffer.from(`${input.username}:${input.password ?? ''}`).toString('base64')}`;
      }
      res = await request(input.host, input.port, input.tls, [base[0], 'CSeq: 2', `Authorization: ${auth}`, ...base.slice(2)], timeoutMs);
    }
    if (res.status === 200) return { ok: true, status: 200 };
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'AUTH', message: MESSAGES.AUTH };
    if (res.status === 404) return { ok: false, code: 'NOT_FOUND', message: MESSAGES.NOT_FOUND };
    return { ok: false, code: 'PROTOCOL', message: `來源回應 ${res.status}` };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ETIMEDOUT') return { ok: false, code: 'TIMEOUT', message: MESSAGES.TIMEOUT };
    if (code === 'ECONNREFUSED') return { ok: false, code: 'REFUSED', message: MESSAGES.REFUSED };
    if (code === 'EPROTO_RTSP') return { ok: false, code: 'PROTOCOL', message: MESSAGES.PROTOCOL };
    return { ok: false, code: 'UNREACHABLE', message: MESSAGES.UNREACHABLE };
  }
}
