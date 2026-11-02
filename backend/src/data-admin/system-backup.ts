import { isAbsolute, normalize, relative } from 'path';

const NAME_PATTERN = /^syncdrive-\d{8}-\d{6}-(manual|auto)$/;
/** 備份只寫給人看管的資料夾，這些系統路徑一律不收 */
const FORBIDDEN_ROOTS = ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sbin', '/sys', '/usr', '/app/dist', '/app/node_modules', '/app/scripts'];

const pad = (value: number) => String(value).padStart(2, '0');

/** 本次備份的資料夾名稱，用後端主機時間，人看得懂也能排序 */
export function backupRunName(trigger: 'manual' | 'auto', at: number): string {
  const d = new Date(at);
  return `syncdrive-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${trigger}`;
}

/** 刪除前的最後防線：只動得了本系統命名的備份資料夾 */
export function isBackupRunName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** 下一次「每天 HH:mm」，今天已過就排明天。排程走真實時間，不跟營運時鐘。 */
export function nextBackupAt(time: string, now: number): number {
  const [hour, minute] = time.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function isBackupTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 回傳拒絕原因；可用時回傳 null。只看路徑字串，磁碟與權限另外實測。 */
export function backupDirProblem(dir: unknown, dataDir: string): string | null {
  if (typeof dir !== 'string' || !dir.trim()) return '請輸入儲存位置';
  if (dir.length > 512 || /[\0-\x1f]/.test(dir)) return '儲存位置格式不正確';
  if (!isAbsolute(dir)) return '儲存位置必須是完整路徑（例如 /mnt/nas/syncdrive）';
  if (normalize(dir).replace(/\/+$/, '') !== dir.replace(/\/+$/, '')) return '儲存位置不能包含 . 或 .. 或重複的斜線';
  if (normalize(dir) === '/') return '不能直接放在根目錄';
  if (FORBIDDEN_ROOTS.some((root) => isInside(root, dir))) return '不能放在系統目錄';
  // /app/data 本身就是備份內容，放進去會把舊備份一路打包進新備份
  if (isInside(dataDir, dir)) return '不能放在系統資料夾內';
  return null;
}

/** 超過保留份數的舊自動備份；手動備份不在此列，要人自己刪 */
export function backupsToPrune<T extends { trigger: string; status: string; started_at: string | number }>(runs: T[], keepCount: number): T[] {
  return runs
    .filter((run) => run.trigger === 'auto' && run.status === 'success')
    .sort((a, b) => Number(b.started_at) - Number(a.started_at))
    .slice(keepCount);
}

/** 開始前先估容量：有上一份就用上一份，第一次用資料庫大小的三分之一 */
export function backupSizeEstimate(lastBytes: number | null, databaseBytes: number): number {
  return lastBytes ? Math.ceil(lastBytes * 1.2) : Math.ceil(databaseBytes / 3);
}
