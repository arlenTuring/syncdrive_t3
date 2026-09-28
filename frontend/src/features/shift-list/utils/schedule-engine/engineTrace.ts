/**
 * 排班引擎決策追蹤（除錯用）。
 *
 * 預設不做任何事；重播工具（scripts/）設定 sink 後，引擎在各階段把「選了哪條路線、哪台設施、
 * 出入廠時刻、候選為什麼被拒」送出來，用來比對兩份輸入第一個不同的決策。
 * 追蹤只讀、不影響任何決策；正式執行不會設定 sink。
 */
export type EngineTraceEvent = { stage: string } & Record<string, unknown>;

let sink: ((event: EngineTraceEvent) => void) | null = null;

export function setEngineTraceSink(next: ((event: EngineTraceEvent) => void) | null): void {
  sink = next;
}

export function engineTraceEnabled(): boolean {
  return sink !== null;
}

export function engineTrace(stage: string, data: Record<string, unknown>): void {
  if (sink) sink({ stage, ...data });
}
