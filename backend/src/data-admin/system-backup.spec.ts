import { backupDirProblem, backupRunName, backupSizeEstimate, backupsToPrune, isBackupRunName, isBackupTime, nextBackupAt } from './system-backup';

const DATA_DIR = '/app/data';

describe('system backup rules', () => {
  it('今天時間未到排今天，已過排明天', () => {
    const now = new Date(2026, 10, 1, 2, 0, 0).getTime();
    expect(nextBackupAt('03:00', now)).toBe(new Date(2026, 10, 1, 3, 0, 0).getTime());
    expect(nextBackupAt('01:00', now)).toBe(new Date(2026, 10, 2, 1, 0, 0).getTime());
    expect(nextBackupAt('02:00', now)).toBe(new Date(2026, 10, 2, 2, 0, 0).getTime());
  });

  it('只接受完整、非系統、不在資料夾內的路徑', () => {
    expect(backupDirProblem('/mnt/nas/syncdrive', DATA_DIR)).toBeNull();
    expect(backupDirProblem('/mnt/nas/syncdrive/', DATA_DIR)).toBeNull();
    expect(backupDirProblem('', DATA_DIR)).toContain('請輸入');
    expect(backupDirProblem('backups', DATA_DIR)).toContain('完整路徑');
    expect(backupDirProblem('/mnt/../etc', DATA_DIR)).toContain('..');
    expect(backupDirProblem('/', DATA_DIR)).toContain('根目錄');
    expect(backupDirProblem('/etc/backups', DATA_DIR)).toContain('系統目錄');
    expect(backupDirProblem('/app/data/backups', DATA_DIR)).toContain('資料夾內');
    expect(backupDirProblem('/app/dataset', DATA_DIR)).toBeNull();
  });

  it('只保留最新 N 份自動備份，手動與失敗的不動', () => {
    const runs = [
      { id: 'a1', trigger: 'auto', status: 'success', started_at: '100' },
      { id: 'a2', trigger: 'auto', status: 'success', started_at: '300' },
      { id: 'a3', trigger: 'auto', status: 'success', started_at: '200' },
      { id: 'm1', trigger: 'manual', status: 'success', started_at: '50' },
      { id: 'f1', trigger: 'auto', status: 'failed', started_at: '10' },
    ];
    expect(backupsToPrune(runs, 2).map((run) => run.id)).toEqual(['a1']);
    expect(backupsToPrune(runs, 7)).toEqual([]);
  });

  it('刪除只認得本系統產生的資料夾名稱', () => {
    const name = backupRunName('auto', new Date(2026, 10, 1, 3, 4, 5).getTime());
    expect(name).toBe('syncdrive-20261101-030405-auto');
    expect(isBackupRunName(name)).toBe(true);
    expect(isBackupRunName('../../etc')).toBe(false);
    expect(isBackupRunName('syncdrive-20261101-030405-auto/..')).toBe(false);
    expect(isBackupRunName('')).toBe(false);
  });

  it('時間格式與容量估算', () => {
    expect(isBackupTime('03:00')).toBe(true);
    expect(isBackupTime('24:00')).toBe(false);
    expect(isBackupTime(300)).toBe(false);
    expect(backupSizeEstimate(1000, 9000)).toBe(1200);
    expect(backupSizeEstimate(null, 9000)).toBe(3000);
  });
});
