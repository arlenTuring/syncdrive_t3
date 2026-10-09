/**
 * 優先程度搶占的格位池——與 groupSlotPool.ts 的索引式 sticky-pool 並存，互不影響：
 * 舊群組（groupSlotAssignment='sticky-pool'）繼續用 assignStickyPoolSlots；新群組
 * （genericGroup.enabled）用這裡的 assignPrioritySlots。
 *
 * 規則（對應規格 §4）：
 *   1. 先濾掉已失效的候選項目（呼叫端先算好 valid，這裡只認 valid=true）。
 *   2. 依優先程度由高到低排序。
 *   3. 同優先用呼叫端算好的 sortKey；相同則按候選陣列原始順序（穩定排序）。
 *   4. 選出容量內最高優先的項目，填入目前空著的格位。
 *   5. 新高優先項目到達且已滿位，立即替換目前顯示中優先程度最低的項目。
 *   6. 被替換的項目不特別記錄「候補」——它只要還在候選清單裡、還 valid，
 *      下次呼叫時會自然重新參與排序；不需要額外的候補佇列狀態。
 *   7. 高優先項目結束（valid 變 false 或從候選消失）後，空出的格位由目前最高
 *      優先的候補項目遞補，用它最新的資料顯示。
 *   8. 同優先的新項目預設不搶占（`preemptEqualPriority` 為 false 時，只有嚴格更高
 *      優先才會替換）；設 true 時同優先且 `tieBreakUpdatedAt` 較新的才搶占。
 *
 * 分兩步：先「選出」哪些項目可見（上面 1–8），再「排列」可見項目的位置：
 *   - arrange='priority'（預設）：優先程度高者在前；同優先依次排序；再相同維持
 *     上一輪的位置，新進項目排在同分的既有項目後面（穩定，不會同分互換）。
 *   - arrange='keep'：保留既有位置，只把空格往左補齊。
 * 選取時保留舊格位只是為了判斷「誰被換掉」，最後位置一律由排列步驟決定。
 *
 * changedIndices 只回報「這個索引上的身分（uid）跟上一輪不同」；卡片只是換位置
 * 時呼叫端應該依 uid 做位移動畫，不是當成換卡翻頁（見 GenericSlotsGroupView）。
 */

export interface PriorityCandidate {
  /** 唯一鍵——預設「來源 id + 項目 id」，由呼叫端組好傳入 */
  uid: string;
  priority: number;
  /** 同優先次排序用；型別統一成可比較的 string｜number，呼叫端依 GroupSortRule 取值 */
  sortKey?: string | number;
  /** 次排序降冪（數字與字串都適用） */
  sortDesc?: boolean;
  /** preemptEqualPriority 時的同優先「較新」判斷依據 */
  updatedAt?: number;
  /** 是否通過有效性規則；呼叫端算好傳入，這裡只做篩選不做判斷 */
  valid: boolean;
  /**
   * 內容版本：同一 uid 但版本變了，呼叫端要用來觸發翻頁而不是原地更新
   * （規格 §7）。這裡只是單純傳遞，不參與任何排序/搶占判斷。
   */
  contentVersion?: string;
  /** 供樣板綁定與後續處理用的原始資料（含別名欄位） */
  row: Record<string, unknown>;
}

export type PrioritySlotCell = { uid: string; row: Record<string, unknown>; contentVersion?: string } | null;

export interface AssignPrioritySlotsResult {
  slots: PrioritySlotCell[];
  /** 身分（uid）改變的格位索引——換了完全不同的項目，需要進場/退場動畫 */
  changedIndices: number[];
  /** 有效但這次沒選進可見格位的候選數量，供「還有 N 筆未顯示」提示 */
  pendingCount: number;
}

/** 優先程度降冪，再依次排序；都相同回傳 0，交給呼叫端決定穩定次序 */
function compareByPriority(a: PriorityCandidate, b: PriorityCandidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return compareSortKey(a, b);
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareSortKey(a: PriorityCandidate, b: PriorityCandidate): number {
  if (a.sortKey != null && b.sortKey != null && a.sortKey !== b.sortKey) {
    const asc = typeof a.sortKey === 'number' && typeof b.sortKey === 'number'
      ? a.sortKey - b.sortKey
      : naturalCollator.compare(String(a.sortKey), String(b.sortKey));
    return a.sortDesc ? -asc : asc;
  }
  return 0;
}

export function assignPrioritySlots(
  prevSlots: PrioritySlotCell[],
  candidates: PriorityCandidate[],
  capacity: number,
  opts: { preemptEqualPriority?: boolean; arrange?: 'priority' | 'sort' | 'keep' } = {},
): AssignPrioritySlotsResult {
  const n = Math.max(1, capacity);
  const preemptEqual = opts.preemptEqualPriority ?? false;
  const arrange = opts.arrange ?? 'priority';

  // 規則 1：只認 valid 的候選；順便記住原始順序供穩定排序
  const validCandidatesWithDuplicates = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.valid);
  // mergeIdField 會讓不同來源的同一實體共用 uid；先依既有優先規則選一張，再安排位置。
  const bestByUid = new Map<string, typeof validCandidatesWithDuplicates[number]>();
  for (const entry of validCandidatesWithDuplicates) {
    const current = bestByUid.get(entry.c.uid);
    if (!current || compareByPriority(entry.c, current.c) < 0) bestByUid.set(entry.c.uid, entry);
  }
  const validCandidates = [...bestByUid.values()];
  const byUid = new Map(validCandidates.map(({ c }) => [c.uid, c]));

  // 規則 2、3：全體候選排序（高優先在前，同優先依 sortKey，再不然依原始順序）
  const ranked = [...validCandidates].sort((x, y) => compareByPriority(x.c, y.c) || x.i - y.i);
  const rankOf = new Map(ranked.map(({ c }, idx) => [c.uid, idx]));

  const next: PrioritySlotCell[] = Array.from({ length: n }, (_, i) => prevSlots[i] ?? null);
  const changedIndices: number[] = [];

  // 先把已經不在候選集合（消失或轉為失效）的格位清空——規則 7 的前置
  for (let i = 0; i < n; i++) {
    const cell = next[i];
    if (cell && !byUid.has(cell.uid)) {
      next[i] = null;
      changedIndices.push(i);
    } else if (cell) {
      // 身分沒變，資料可能更新了——原地換資料，不算 changedIndices（呼叫端另外判斷內容版本）
      const fresh = byUid.get(cell.uid)!;
      next[i] = { uid: cell.uid, row: fresh.row, contentVersion: fresh.contentVersion };
    }
  }

  const displayedUids = () => new Set(next.filter((c): c is NonNullable<PrioritySlotCell> => c !== null).map(c => c.uid));

  // 規則 4：空格位優先依序遞補目前排序最前面、還沒顯示的候選
  const fillEmptySlots = () => {
    const shown = displayedUids();
    const pendingRanked = ranked.filter(({ c }) => !shown.has(c.uid));
    let q = 0;
    for (let i = 0; i < n; i++) {
      if (next[i] !== null) continue;
      const entry = pendingRanked[q++];
      if (!entry) continue;
      next[i] = { uid: entry.c.uid, row: entry.c.row, contentVersion: entry.c.contentVersion };
      changedIndices.push(i);
      shown.add(entry.c.uid);
    }
  };
  fillEmptySlots();

  // 規則 5、8：滿位時，最高優先的候補是否該搶占目前顯示中最低優先的格位
  const preempt = () => {
    for (let guard = 0; guard < n; guard++) {
      const shown = displayedUids();
      const pendingTop = ranked.find(({ c }) => !shown.has(c.uid));
      if (!pendingTop) return;

      let worstIdx = -1;
      let worstRank = -1;
      for (let i = 0; i < n; i++) {
        const cell = next[i];
        if (!cell) return; // 理论上不会有空格（fillEmptySlots 先跑过），保险起见
        const r = rankOf.get(cell.uid) ?? -1;
        if (r > worstRank) {
          worstRank = r;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) return;

      const incoming = pendingTop.c;
      const displaced = next[worstIdx]!;
      const displacedCandidate = byUid.get(displaced.uid)!;
      const beatsStrictly = incoming.priority > displacedCandidate.priority;
      const beatsEqual =
        preemptEqual &&
        incoming.priority === displacedCandidate.priority &&
        (incoming.updatedAt ?? 0) > (displacedCandidate.updatedAt ?? 0);
      if (!beatsStrictly && !beatsEqual) return; // 候補已排序，排最前的都贏不了就不用再看後面

      next[worstIdx] = { uid: incoming.uid, row: incoming.row, contentVersion: incoming.contentVersion };
      changedIndices.push(worstIdx);
    }
  };
  preempt();

  // 排列步驟。keep：維持選取後的格位，只左靠齊；priority：依優先程度重排，
  // 同分時上一輪在前的維持在前（prevSlots 的索引），新進的排在同分既有項目之後。
  const occupied = next
    .map((cell, idx) => ({ cell, idx }))
    .filter((x): x is { cell: NonNullable<PrioritySlotCell>; idx: number } => x.cell !== null);
  if (arrange === 'priority' || arrange === 'sort') {
    const prevIndex = new Map<string, number>();
    prevSlots.forEach((cell, i) => { if (cell) prevIndex.set(cell.uid, i); });
    const origOrder = new Map(validCandidates.map(({ c, i }) => [c.uid, i]));
    occupied.sort((x, y) => {
      const byConfiguredOrder = arrange === 'sort'
        ? compareSortKey(byUid.get(x.cell.uid)!, byUid.get(y.cell.uid)!)
        : compareByPriority(byUid.get(x.cell.uid)!, byUid.get(y.cell.uid)!);
      if (byConfiguredOrder !== 0) return byConfiguredOrder;
      const px = prevIndex.get(x.cell.uid) ?? Number.POSITIVE_INFINITY;
      const py = prevIndex.get(y.cell.uid) ?? Number.POSITIVE_INFINITY;
      if (px !== py) return px - py;
      return (origOrder.get(x.cell.uid) ?? 0) - (origOrder.get(y.cell.uid) ?? 0);
    });
  }
  const arranged: PrioritySlotCell[] = [
    ...occupied.map(x => x.cell),
    ...Array.from({ length: n - occupied.length }, () => null),
  ];

  // 身分變更一律跟上一輪比：同一個 uid 只是換位置，在新位置上仍會被標記（該索引的
  // 身分確實變了），但呼叫端依 uid 渲染時那是位移，不是換卡。
  changedIndices.length = 0;
  for (let i = 0; i < n; i++) {
    if ((prevSlots[i]?.uid ?? null) !== (arranged[i]?.uid ?? null)) changedIndices.push(i);
  }

  const finalShown = new Set(occupied.map(x => x.cell.uid));
  const pendingCount = validCandidates.filter(({ c }) => !finalShown.has(c.uid)).length;

  return { slots: arranged, changedIndices, pendingCount };
}
