import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

/**
 * 本機開發用：在後端（含本機的 3100）上開一個排班白皮書入口，給使用者與審閱者直接打開。
 *
 *   http://localhost:3100/schedule-whitepaper/
 *
 * 只放<strong>兩份指定檔案</strong>，不公開整個 document/ 目錄：白皮書本身，以及它以相對
 * 路徑連過去的「最近一次生成的問題」。正式環境（NODE_ENV=production）整個不掛——正式機的
 * 白皮書走內部入口（port 80 的 /docs/），對外埠只給協力廠商看對外文件。
 *
 * 用 express middleware 而不是 Nest 路由：它不是 API，不該出現在 Swagger，也不需要
 * 掛 @ExternalApi 把內部文件包裝成對外介面。
 *
 * <strong>只給本機連線。</strong>後端監聽所有網路介面，光靠「不是 production」擋不住同網段
 * 的其他機器。這裡看的是 TCP 連線的實際來源位址（不看 X-Forwarded-For 之類可偽造的
 * 標頭），不是 loopback 就當作這個路徑不存在（404），其他路由與 API 隔離完全不受影響。
 */
const BASE = '/schedule-whitepaper';
const FILES: Record<string, string> = {
  '': '排班引擎算法全覽-審核.html',
  '排班引擎算法全覽-審核.html': '排班引擎算法全覽-審核.html',
  '排班引擎最近問題.html': '排班引擎最近問題.html',
};

/** 127.0.0.0/8 與 ::1；IPv4 連到雙堆疊 socket 時會是 ::ffff:127.x.x.x */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.')
  );
}

export function scheduleWhitepaperDevMiddleware(documentDir: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path || '';
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    // 相對連結要從 /schedule-whitepaper/ 底下解析，所以沒有斜線的先轉過去
    if (path === BASE) {
      res.redirect(302, `${BASE}/`);
      return;
    }
    const name = decodeURIComponent(path.slice(BASE.length + 1));
    const file = FILES[name];
    if (!file) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    const full = resolve(documentDir, file);
    if (!existsSync(full)) {
      res.status(404).json({ statusCode: 404, message: `找不到 ${file}` });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(full);
  };
}
