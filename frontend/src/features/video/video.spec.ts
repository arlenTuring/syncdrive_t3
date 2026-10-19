import { describe, expect, it } from 'vitest';
import type { Manifest, Tile, VideoSourceItem } from './api';
import { gridColumns } from './layout';
import { tileBadges } from './status';
import { nextAvailable, segmentAt, syncAction, timelineAt } from './sync';

const manifest = {
  segments: [
    { id: 'a', start: 1_000, end: 2_000 },
    { id: 'b', start: 2_000, end: 3_000 },
    { id: 'c', start: 5_000, end: 6_000 },
  ],
  timeline: [
    { kind: 'available', from: 1_000, to: 3_000 },
    { kind: 'gap', from: 3_000, to: 5_000, reason: '來源離線' },
    { kind: 'available', from: 5_000, to: 6_000 },
  ],
} as unknown as Manifest;

const tile = (patch: Partial<Tile> = {}): Tile => ({ id: 't', position: 0, sourceId: 's', displayName: null, recordingRequested: true, enabled: true, templateVars: {}, version: 1, ...patch });
const source = (patch: Partial<VideoSourceItem> = {}): VideoSourceItem =>
  ({ id: 's', name: '前門', enabled: true, usage: { tiles: 1, recording: 1 }, actualStatus: { state: 'ready', recording: true }, ...patch }) as VideoSourceItem;

describe('歷史回放的時間對齊', () => {
  it('片段是半開區間：邊界時間屬於下一段', () => {
    expect(segmentAt(manifest, 1_999)?.id).toBe('a');
    expect(segmentAt(manifest, 2_000)?.id).toBe('b');
    expect(segmentAt(manifest, 3_000)).toBeNull();
  });

  it('缺段時查得到原因與下一段開始時間', () => {
    expect(timelineAt(manifest.timeline, 4_000)).toMatchObject({ kind: 'gap', reason: '來源離線' });
    expect(nextAvailable(manifest, 4_000)).toBe(5_000);
    expect(nextAvailable(manifest, 5_500)).toBeNull();
  });

  it('同步門檻：250ms 內不干預、1 秒內微調速度、超過就定位', () => {
    expect(syncAction(10, 10.2, 1)).toEqual({ kind: 'none' });
    expect(syncAction(10, 10.5, 1)).toEqual({ kind: 'rate', rate: 0.9 });
    expect(syncAction(10, 9.5, 2)).toEqual({ kind: 'rate', rate: 2.2 });
    expect(syncAction(10, 11.5, 1)).toEqual({ kind: 'seek', to: 10 });
  });
});

describe('監控版面', () => {
  it('依格數決定欄數，最多四欄', () => {
    expect(gridColumns(1)).toBe('grid-cols-1');
    expect(gridColumns(4)).toContain('sm:grid-cols-2');
    expect(gridColumns(9)).toContain('lg:grid-cols-3');
    expect(gridColumns(12)).toContain('xl:grid-cols-4');
  });
});

describe('格子狀態徽章', () => {
  it('沒設定來源只顯示未設定', () => {
    expect(tileBadges(tile({ sourceId: null }), undefined, null)).toEqual([{ text: '未設定', tone: 'zinc' }]);
  });

  it('連線與錄影狀態分開顯示', () => {
    const texts = tileBadges(tile(), source(), { state: 'playing' } as never).map((b) => b.text);
    expect(texts).toEqual(['播放中', '錄影中']);
  });

  it('要求錄影但空間不足時說明原因，不假裝在錄', () => {
    const badges = tileBadges(tile(), source({ actualStatus: { state: 'ready', recording: false, reason: '錄影暫停：空間不足' } as never }), null);
    expect(badges.map((b) => b.text)).toContain('錄影暫停：空間不足');
    expect(badges.map((b) => b.text)).not.toContain('錄影中');
  });

  it('此格取消錄影但其他格仍錄同一來源時文案正確', () => {
    const texts = tileBadges(tile({ recordingRequested: false }), source({ usage: { tiles: 2, recording: 1 } }), null).map((b) => b.text);
    expect(texts).toContain('此格不要求錄影；來源仍由其他格儲存');
  });

  it('只看即時的格子', () => {
    const texts = tileBadges(tile({ recordingRequested: false }), source({ usage: { tiles: 1, recording: 0 } }), null).map((b) => b.text);
    expect(texts).toContain('僅即時');
  });
});
