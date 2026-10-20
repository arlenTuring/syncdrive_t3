import type { PlayerStats } from './LivePlayer';
import type { SourceOption, VideoSourceItem } from './api';

export type Badge = { text: string; tone: 'zinc' | 'sky' | 'green' | 'red' | 'amber' };

export const BADGE_TONE: Record<Badge['tone'], string> = {
  zinc: 'bg-zinc-700/70 text-zinc-200',
  sky: 'bg-sky-500/20 text-sky-200',
  green: 'bg-emerald-500/20 text-emerald-200',
  red: 'bg-red-500/25 text-red-200',
  amber: 'bg-amber-500/20 text-amber-100',
};

/**
 * 來源的上線狀態（實際探測結果；與「啟用」這個使用者指令分開）。
 * 狀態過期（太久沒更新）就是「狀態待更新」，不沿用上次的綠燈。
 */
export function onlineBadge(source: Pick<VideoSourceItem, 'enabled' | 'actualStatus'>): Badge {
  const st = source.actualStatus ?? {};
  if (!source.enabled) return { text: '已停用', tone: 'zinc' };
  if (st.stale || !st.state) return { text: '狀態待更新', tone: 'zinc' };
  if (st.state === 'online') return { text: '線上', tone: 'green' };
  if (st.state === 'media_unavailable') return { text: '影像服務無法連線', tone: 'red' };
  if (st.state === 'offline' || st.state === 'error') return { text: '離線', tone: 'red' };
  return { text: '狀態待更新', tone: 'zinc' };
}

/** 錄影：設定（儲存錄影）與實際狀態分開；空間不足時保留設定、顯示暫停 */
export function recordingBadge(source: Pick<VideoSourceItem, 'enabled' | 'recordingEnabled' | 'actualStatus'>): Badge {
  const st = source.actualStatus ?? {};
  if (!source.recordingEnabled) return { text: '不儲存', tone: 'zinc' };
  if (!source.enabled) return { text: '來源停用，不錄影', tone: 'zinc' };
  if (st.recording && !st.stale) return { text: '錄影中', tone: 'red' };
  if (st.reason?.startsWith('錄影暫停')) return { text: st.reason, tone: 'amber' };
  if (st.stale || !st.state) return { text: '等待開始錄影', tone: 'amber' };
  return { text: st.reason ? `未錄影：${st.reason}` : '等待開始錄影', tone: 'amber' };
}

export const OPTION_STATE_LABEL: Record<SourceOption['state'], string> = {
  online: '線上',
  offline: '離線',
  unknown: '狀態待更新',
  connecting: '連線中',
  error: '設定錯誤',
  disabled: '已停用',
  deleted: '已刪除',
  media_unavailable: '影像服務無法連線',
};

/** 監控格子的狀態列：來源狀態＋播放器實際狀態（錄影屬於來源設定，不在格子顯示開關） */
export function tileBadges(source: SourceOption | undefined, bound: boolean, stats: PlayerStats | null): Badge[] {
  if (!bound) return [{ text: '未設定來源', tone: 'zinc' }];
  if (!source || source.deleted) return [{ text: '來源已刪除', tone: 'red' }];
  if (!source.enabled) return [{ text: '來源已停用', tone: 'zinc' }];
  if (stats?.state === 'playing') return [{ text: '播放中', tone: 'green' }];
  if (stats?.state === 'error') return [{ text: stats.error ?? '連線中斷', tone: 'red' }];
  if (source.state === 'offline' || source.state === 'error') return [{ text: '來源離線，等待恢復', tone: 'red' }];
  return [{ text: '連線中', tone: 'sky' }];
}
