import type { PlayerStats } from './LivePlayer';
import type { Tile, VideoSourceItem } from './api';

export type Badge = { text: string; tone: 'zinc' | 'sky' | 'green' | 'red' | 'amber' };

export const BADGE_TONE: Record<Badge['tone'], string> = {
  zinc: 'bg-zinc-700/70 text-zinc-200',
  sky: 'bg-sky-500/20 text-sky-200',
  green: 'bg-emerald-500/20 text-emerald-200',
  red: 'bg-red-500/25 text-red-200',
  amber: 'bg-amber-500/20 text-amber-100',
};

/** 格子狀態徽章：連線狀態與錄影狀態分開，錄影區分「需求」與「實際」 */
export function tileBadges(tile: Tile, source: VideoSourceItem | undefined, stats: PlayerStats | null): Badge[] {
  if (!tile.sourceId || !source) return [{ text: '未設定', tone: 'zinc' }];
  const badges: Badge[] = [];
  const st = source.actualStatus ?? {};
  if (!source.enabled) badges.push({ text: '來源已停用', tone: 'zinc' });
  else if (st.state === 'media_unavailable') badges.push({ text: '影像服務無法連線', tone: 'red' });
  else if (st.state === 'error') badges.push({ text: st.reason ?? '來源設定有誤', tone: 'red' });
  else if (stats?.state === 'playing') badges.push({ text: '播放中', tone: 'green' });
  else if (stats?.state === 'error') badges.push({ text: stats.error ?? '連線中斷', tone: 'red' });
  else badges.push({ text: '連線中', tone: 'sky' });
  if (tile.recordingRequested) {
    if (st.recording) badges.push({ text: '錄影中', tone: 'red' });
    else if (st.reason) badges.push({ text: st.reason.startsWith('錄影') ? st.reason : `未錄影：${st.reason}`, tone: 'amber' });
    else badges.push({ text: '等待開始錄影', tone: 'amber' });
  } else if (source.usage.recording > 0) {
    badges.push({ text: '此格不要求錄影；來源仍由其他格儲存', tone: 'zinc' });
  } else {
    badges.push({ text: '僅即時', tone: 'zinc' });
  }
  return badges;
}

