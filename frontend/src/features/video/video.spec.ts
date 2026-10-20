import { describe, expect, it } from 'vitest';
import type { Manifest, SourceOption, VideoSourceItem } from './api';
import { CANVAS, addTile, evenLayout, groupSources, snapMove, snapRect, validLayout, validRect, type DraftTile } from './layout';
import { onlineBadge, recordingBadge, tileBadges } from './status';
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

let seq = 0;
const k = () => `k${(seq += 1)}`;

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

describe('監控版面編輯', () => {
  it('第一格滿版、第二格左右各半', () => {
    const one = addTile([], null, k())!;
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ x: 0, y: 0, w: CANVAS, h: CANVAS });
    const two = addTile(one, null, k())!;
    expect(two.map((t) => [t.x, t.w])).toEqual([[0, 5000], [5000, 5000]]);
  });

  it('第三格起只分割選取的格子（沒選就是最大的），其他格子不動；較高的格子上下分割', () => {
    const two = addTile(addTile([], null, k())!, null, k())!;
    const [left, right] = two;
    const three = addTile(two, right.key, k())!;
    expect(three.find((t) => t.key === left.key)).toEqual(left);
    const split = three.filter((t) => t.key !== left.key);
    expect(split.map((t) => [t.x, t.y, t.w, t.h])).toEqual([[5000, 0, 5000, 5000], [5000, 5000, 5000, 5000]]);
    const four = addTile(three, null, k())!;
    expect(four.find((t) => t.key === left.key)?.h).toBe(5000);
    expect(validLayout(four)).toBe(true);
  });

  it('最多 12 格；平均重排要使用者觸發，結果合法不重疊', () => {
    let tiles: DraftTile[] = [];
    for (let i = 0; i < 12; i += 1) tiles = addTile(tiles, null, k()) ?? tiles;
    expect(tiles).toHaveLength(12);
    expect(addTile(tiles, null, k())).toBeNull();
    const even = evenLayout(tiles, 16 / 9);
    expect(validLayout(even)).toBe(true);
    expect(even.map((t) => t.key)).toEqual(tiles.map((t) => t.key));
  });

  it('不合法的位置（重疊、越界、太小、非整數）會被拒絕；相接的邊合法', () => {
    const a = { x: 0, y: 0, w: 5000, h: 10000 };
    expect(validRect({ x: 5000, y: 0, w: 5000, h: 10000 }, [a])).toBe(true);
    expect(validRect({ x: 4900, y: 0, w: 5000, h: 10000 }, [a])).toBe(false);
    expect(validRect({ x: 6000, y: 0, w: 5000, h: 10000 }, [])).toBe(false);
    expect(validRect({ x: 0, y: 0, w: 400, h: 1000 }, [])).toBe(false);
    expect(validRect({ x: 0.5, y: 0, w: 1000, h: 1000 }, [])).toBe(false);
  });

  it('放開時吸附到其他格子的邊與畫布邊；移動不改變大小', () => {
    const other = { x: 0, y: 0, w: 5000, h: 10000 };
    expect(snapRect({ x: 5120, y: 90, w: 4790, h: 9850 }, [other])).toEqual({ x: 5000, y: 0, w: 5000, h: 10000 });
    expect(snapMove({ x: 5150, y: 130, w: 4000, h: 5000 }, [other])).toEqual({ x: 5000, y: 0, w: 4000, h: 5000 });
  });
});

const opt = (patch: Partial<SourceOption>): SourceOption => ({ id: 'x', name: 'x', tags: [], vehicleCode: null, location: null, enabled: true, deleted: false, state: 'online', ...patch });

describe('來源選單分組', () => {
  it('多標籤來源只出現一次，以排序第一個標籤分組；未分類放最後；全半形大小寫視為同組', () => {
    const groups = groupSources([
      opt({ id: '1', name: '後門', tags: ['月台', 'Gate'] }),
      opt({ id: '2', name: '前門', tags: ['ＧＡＴＥ'] }),
      opt({ id: '3', name: '機房' }),
      opt({ id: '4', name: '月台東', tags: ['月台'] }),
    ], '');
    // 依中文排序：「月台」排在「gate」前，所以「後門」歸在月台組；只有「前門」在 gate 組
    expect(groups.map((g) => g.label)).toEqual(['月台', 'ＧＡＴＥ', '未分類']);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['1', '4']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['2']);
    expect(groups.flatMap((g) => g.items).filter((i) => i.id === '1')).toHaveLength(1);
  });

  it('搜尋比對名稱、全部標籤、載具與位置', () => {
    const list = [opt({ id: '1', name: 'A', tags: ['x', '北側'] }), opt({ id: '2', name: 'B', vehicleCode: 'PMS03' }), opt({ id: '3', name: 'C', location: '車頭' })];
    expect(groupSources(list, '北側').flatMap((g) => g.items).map((i) => i.id)).toEqual(['1']);
    expect(groupSources(list, 'pms03').flatMap((g) => g.items).map((i) => i.id)).toEqual(['2']);
    expect(groupSources(list, '車頭').flatMap((g) => g.items).map((i) => i.id)).toEqual(['3']);
  });
});

const src = (patch: Partial<VideoSourceItem>) => ({ enabled: true, recordingEnabled: true, actualStatus: { state: 'online', recording: true, checkedAt: 1, stale: false }, ...patch }) as VideoSourceItem;

describe('來源與格子狀態', () => {
  it('啟用、上線、錄影分開；過期狀態不沿用綠燈', () => {
    expect(onlineBadge(src({})).text).toBe('線上');
    expect(onlineBadge(src({ actualStatus: { state: 'online', stale: true } })).text).toBe('狀態待更新');
    expect(onlineBadge(src({ enabled: false })).text).toBe('已停用');
    expect(onlineBadge(src({ actualStatus: { state: 'offline', reason: '連線逾時', stale: false } })).text).toBe('離線');
  });

  it('錄影：不儲存、錄影中、空間不足暫停（保留設定）', () => {
    expect(recordingBadge(src({ recordingEnabled: false })).text).toBe('不儲存');
    expect(recordingBadge(src({})).text).toBe('錄影中');
    expect(recordingBadge(src({ actualStatus: { state: 'online', recording: false, reason: '錄影暫停：空間不足', stale: false } })).text).toBe('錄影暫停：空間不足');
  });

  it('格子：未設定、來源已刪除、已停用、離線等待恢復、播放中', () => {
    expect(tileBadges(undefined, false, null)[0].text).toBe('未設定來源');
    expect(tileBadges(undefined, true, null)[0].text).toBe('來源已刪除');
    expect(tileBadges(opt({ enabled: false }), true, null)[0].text).toBe('來源已停用');
    expect(tileBadges(opt({ state: 'offline' }), true, null)[0].text).toBe('來源離線，等待恢復');
    expect(tileBadges(opt({}), true, { state: 'playing' } as never)[0].text).toBe('播放中');
  });
});
