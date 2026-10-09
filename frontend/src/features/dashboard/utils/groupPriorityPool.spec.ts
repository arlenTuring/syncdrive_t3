import { describe, expect, it } from 'vitest';
import { assignPrioritySlots, type PriorityCandidate, type PrioritySlotCell } from './groupPriorityPool';

// 跟車輛／班次無關的通用測試資料，比照規格 §9 驗收案例
function candidate(uid: string, priority: number, opts: Partial<PriorityCandidate> = {}): PriorityCandidate {
  return { uid, priority, valid: true, row: { uid, priority }, ...opts };
}

const empty = (n: number): PrioritySlotCell[] => Array.from({ length: n }, () => null);

describe('assignPrioritySlots', () => {
  it('案例1：容量 6 格，來源 A/B 共 10 筆，選出最高優先的 6 筆', () => {
    const candidates = [
      candidate('A-1', 10), candidate('A-2', 8), candidate('A-3', 6),
      candidate('A-4', 4), candidate('A-5', 2),
      candidate('B-1', 9), candidate('B-2', 7), candidate('B-3', 5),
      candidate('B-4', 3), candidate('B-5', 1),
    ];
    const result = assignPrioritySlots(empty(6), candidates, 6);
    const shown = result.slots.map(s => s?.uid).filter(Boolean).sort();
    expect(shown).toEqual(['A-1', 'A-2', 'A-3', 'B-1', 'B-2', 'B-3'].sort());
    expect(result.pendingCount).toBe(4);
  });

  it('案例2：新增高優先來源 C 項目，立即替換最低優先卡片', () => {
    const round1 = assignPrioritySlots(empty(3), [
      candidate('A-1', 10), candidate('A-2', 8), candidate('A-3', 6), candidate('A-4', 4),
    ], 3);
    expect(round1.slots.map(s => s?.uid)).toEqual(['A-1', 'A-2', 'A-3']);

    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 10), candidate('A-2', 8), candidate('A-3', 6), candidate('A-4', 4),
      candidate('C-1', 99),
    ], 3);
    const shown2 = round2.slots.map(s => s?.uid);
    expect(shown2).toContain('C-1');
    expect(shown2).not.toContain('A-3'); // 最低優先(6)的被替換
    expect(shown2).toContain('A-1');
    expect(shown2).toContain('A-2');
  });

  it('案例3：C 解除後，候補以最新資料回補', () => {
    const round1 = assignPrioritySlots(empty(3), [
      candidate('A-1', 10), candidate('A-2', 8), candidate('A-3', 6), candidate('A-4', 4),
      candidate('C-1', 99),
    ], 3);
    expect(round1.slots.map(s => s?.uid)).toContain('C-1');

    // C-1 解除：從候選清單消失（valid 集合不再包含）
    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 10), candidate('A-2', 8), candidate('A-3', 6, { row: { uid: 'A-3', priority: 6, note: 'fresh' } }),
      candidate('A-4', 4),
    ], 3);
    const shown2 = round2.slots.map(s => s?.uid);
    expect(shown2).not.toContain('C-1');
    expect(shown2).toContain('A-3'); // 候補回補：下一個最高優先
    const a3 = round2.slots.find(s => s?.uid === 'A-3');
    expect(a3?.row).toEqual({ uid: 'A-3', priority: 6, note: 'fresh' }); // 用最新資料
  });

  it('案例4：同優先新項目不造成持續換卡（預設不搶占）', () => {
    const round1 = assignPrioritySlots(empty(2), [
      candidate('A-1', 5), candidate('A-2', 5),
    ], 2);
    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 5), candidate('A-2', 5), candidate('A-3', 5),
    ], 2);
    // 同優先，A-3 不該搶占任何已顯示項目
    expect(round2.slots.map(s => s?.uid)).toEqual(round1.slots.map(s => s?.uid));
    expect(round2.changedIndices).toEqual([]);
    expect(round2.pendingCount).toBe(1);
  });

  it('preemptEqualPriority=true 且較新時，同優先才搶占', () => {
    const round1 = assignPrioritySlots(empty(1), [
      candidate('A-1', 5, { updatedAt: 100 }),
    ], 1);
    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 5, { updatedAt: 100 }),
      candidate('A-2', 5, { updatedAt: 200 }),
    ], 1, { preemptEqualPriority: true });
    expect(round2.slots.map(s => s?.uid)).toEqual(['A-2']);
  });

  it('案例6：ID 不變的資料更新，原地換資料，不觸發 changedIndices', () => {
    const round1 = assignPrioritySlots(empty(2), [candidate('A-1', 5)], 2);
    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 5, { row: { uid: 'A-1', priority: 5, extra: 'updated' } }),
    ], 2);
    expect(round2.changedIndices).toEqual([]);
    const a1 = round2.slots.find(s => s?.uid === 'A-1');
    expect(a1?.row).toEqual({ uid: 'A-1', priority: 5, extra: 'updated' });
  });

  it('案例7：不同來源使用相同 ID，用 uid（來源+項目 ID）分開，不互相覆蓋', () => {
    const result = assignPrioritySlots(empty(4), [
      candidate('sourceA:1', 5, { row: { source: 'A', id: '1' } }),
      candidate('sourceB:1', 3, { row: { source: 'B', id: '1' } }),
    ], 4);
    const shown = result.slots.map(s => s?.uid).filter(Boolean);
    expect(shown).toContain('sourceA:1');
    expect(shown).toContain('sourceB:1');
    expect(shown.length).toBe(2);
  });

  it('失效候選（valid=false）不進入分配，格位釋出給下一個有效候補', () => {
    const round1 = assignPrioritySlots(empty(1), [candidate('A-1', 10)], 1);
    const round2 = assignPrioritySlots(round1.slots, [
      candidate('A-1', 10, { valid: false }),
      candidate('A-2', 1),
    ], 1);
    expect(round2.slots.map(s => s?.uid)).toEqual(['A-2']);
    expect(round2.changedIndices).toEqual([0]);
  });

  describe('排列步驟', () => {
    const fiveLow = () => ['M-1', 'M-2', 'M-3', 'M-4', 'M-5'].map(uid => candidate(uid, 50));

    it('驗收：先顯示五張低優先卡，加入高優先卡後排到第一張（有空格時）', () => {
      const round1 = assignPrioritySlots(empty(6), fiveLow(), 6);
      expect(round1.slots.map(s => s?.uid ?? null)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'M-5', null]);

      const round2 = assignPrioritySlots(round1.slots, [...fiveLow(), candidate('X-1', 100)], 6);
      expect(round2.slots.map(s => s?.uid ?? null)).toEqual(['X-1', 'M-1', 'M-2', 'M-3', 'M-4', 'M-5']);
    });

    it('驗收：滿位時高優先卡搶占後同樣排到第一張，其餘維持原相對順序', () => {
      const round1 = assignPrioritySlots(empty(5), fiveLow(), 5);
      const round2 = assignPrioritySlots(round1.slots, [...fiveLow(), candidate('X-1', 100)], 5);
      expect(round2.slots.map(s => s?.uid)).toEqual(['X-1', 'M-1', 'M-2', 'M-3', 'M-4']);
      expect(round2.pendingCount).toBe(1);
    });

    it('驗收：修改既有卡片的優先程度立即重新排列', () => {
      const round1 = assignPrioritySlots(empty(5), fiveLow(), 5);
      const bumped = fiveLow().map(c => (c.uid === 'M-4' ? { ...c, priority: 90 } : c));
      const round2 = assignPrioritySlots(round1.slots, bumped, 5);
      expect(round2.slots.map(s => s?.uid)).toEqual(['M-4', 'M-1', 'M-2', 'M-3', 'M-5']);
    });

    it('同優先維持上一輪位置，不因候選陣列順序改變而互換', () => {
      const round1 = assignPrioritySlots(empty(3), [candidate('A', 5), candidate('B', 5), candidate('C', 5)], 3);
      const round2 = assignPrioritySlots(round1.slots, [candidate('C', 5), candidate('B', 5), candidate('A', 5)], 3);
      expect(round2.slots.map(s => s?.uid)).toEqual(['A', 'B', 'C']);
      expect(round2.changedIndices).toEqual([]);
    });

    it('同優先依次排序；降冪對字串也有效', () => {
      const cs = [
        candidate('A', 5, { sortKey: '01:30', sortDesc: true }),
        candidate('B', 5, { sortKey: '02:00', sortDesc: true }),
        candidate('C', 5, { sortKey: '00:00', sortDesc: true }),
      ];
      expect(assignPrioritySlots(empty(3), cs, 3).slots.map(s => s?.uid)).toEqual(['B', 'A', 'C']);
    });

    it("arrange='keep' 保留既有位置，只左靠齊", () => {
      const round1 = assignPrioritySlots(empty(6), fiveLow(), 6, { arrange: 'keep' });
      const round2 = assignPrioritySlots(round1.slots, [...fiveLow(), candidate('X-1', 100)], 6, { arrange: 'keep' });
      expect(round2.slots.map(s => s?.uid ?? null)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'X-1']);
    });

    it("arrange='sort' 先依優先權選卡，再用車號自然順序排列", () => {
      const result = assignPrioritySlots(empty(4), [
        candidate('PMS10', 100, { sortKey: 'PMS10' }),
        candidate('PMS2', 50, { sortKey: 'PMS2' }),
        candidate('PMS1', 10, { sortKey: 'PMS1' }),
      ], 4, { arrange: 'sort' });
      expect(result.slots.map(s => s?.uid ?? null)).toEqual(['PMS1', 'PMS2', 'PMS10', null]);
    });
  });

  it('同一 merge uid 只選最高優先候選，不生成兩張卡', () => {
    const result = assignPrioritySlots(empty(2), [
      candidate('PMS01', 50, { row: { type: 'maintenance' } }),
      candidate('PMS01', 100, { row: { type: 'mainline' } }),
    ], 2);
    expect(result.slots.filter(Boolean)).toHaveLength(1);
    expect(result.slots[0]?.row).toEqual({ type: 'mainline' });
  });

  it('容量大於資料筆數時保留空格（呼叫端另決定 overflowFill 撐滿或留空，這裡本身不硬撐）', () => {
    const result = assignPrioritySlots(empty(5), [candidate('A-1', 1), candidate('A-2', 1)], 5);
    expect(result.slots.filter(Boolean).length).toBe(2);
    expect(result.slots.filter(s => s === null).length).toBe(3);
  });
});
