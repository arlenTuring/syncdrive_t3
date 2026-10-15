/**
 * 回放游標與排序（一般運行紀錄、歷史降級共用）。
 *
 * <h3>一幀是什麼</h3>
 * 一幀＝保存資料中依「回放時間 t＋序號 seq」排序的一筆紀錄，不是固定一秒、也不是瀏覽器動畫幀。
 * 逐幀前後移動就是移到相鄰那一筆；同一毫秒有多筆時仍能一筆一筆看。
 *
 * <h3>游標</h3>
 * {t, seq}：狀態包含所有 (t', seq') ≤ (t, seq) 的資料。seq＝null 表示「t 這一毫秒的資料全部套用」
 * （連續播放、拖曳時用）；逐幀時 seq 是某一筆的序號。
 *
 * 序號是資料庫 bigint，一律以十進位字串比較，不轉成 Number（超過 2^53 會失真）。
 */
export type ReplayCursor = { t: number; seq: string | null };

export type FramePosition = { t: number; seq: string };

/** 比較兩個十進位序號字串 */
export function compareSeq(a: string, b: string): number {
  const x = stripZeros(a);
  const y = stripZeros(b);
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

function stripZeros(value: string): string {
  const trimmed = value.replace(/^0+(?=\d)/, "");
  return trimmed || "0";
}

/** 兩筆資料的先後：回放時間，再看序號（同一毫秒的穩定順序） */
export function frameOrder(a: FramePosition, b: FramePosition): number {
  return a.t - b.t || compareSeq(a.seq, b.seq);
}

/** 這一筆是否已經包含在游標的狀態裡 */
export function frameAtOrBefore(frame: FramePosition, cursor: ReplayCursor): boolean {
  if (frame.t !== cursor.t) return frame.t < cursor.t;
  return cursor.seq == null || compareSeq(frame.seq, cursor.seq) <= 0;
}

/** 游標比較：同一毫秒時「整毫秒」（seq＝null）排在該毫秒任何一筆之後 */
export function cursorOrder(a: ReplayCursor, b: ReplayCursor): number {
  if (a.t !== b.t) return a.t - b.t;
  if (a.seq === b.seq) return 0;
  if (a.seq == null) return 1;
  if (b.seq == null) return -1;
  return compareSeq(a.seq, b.seq);
}

export function cursorOf(frame: FramePosition): ReplayCursor {
  return { t: frame.t, seq: frame.seq };
}
