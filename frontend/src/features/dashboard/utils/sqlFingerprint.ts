/**
 * SQL 指紋：比對「這份 SQL 是不是系統某一版內建查詢的原文」。
 *
 * 只去掉註解、把空白收斂成一格；其他任何字元不同（多一個條件、改一個欄位）指紋就不同，
 * 所以使用者改過的查詢不會被誤認成系統版本。
 */
export function normalizeSqlForFingerprint(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** cyrb53：同步、穩定、瀏覽器與 Node 都能跑的 53 位元雜湊（不做安全用途） */
function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function sqlFingerprint(sql: string): string {
  return cyrb53(normalizeSqlForFingerprint(sql)).toString(16).padStart(14, '0');
}
