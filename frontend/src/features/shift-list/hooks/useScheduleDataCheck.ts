import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { ScheduleDataCheckRecord, ShiftScheduleCreateDraft } from '../types/create';
import { checkDraftScheduleData } from '../utils/runShiftScheduleEngineForDraft';
import { resolveScheduleDataSelectionKey } from '../utils/scheduleDataVersion';

/**
 * 路線群組選圖當下的必要資料檢查（白皮書 MAP-02～04）。
 *
 * 進到這一步、換地圖、換路線（或前面步驟換了模板、整備任務）就重跑一次；跟正式生成用同一個
 * 輸入組裝與同一套檢查，結果連同資料指紋存進草稿。生成前再比對一次指紋，檢查後資料被改過就擋。
 */
export function useScheduleDataCheck(args: {
  draft: ShiftScheduleCreateDraft;
  active: boolean;
  onRecord: (record: ScheduleDataCheckRecord) => void;
}) {
  const { draft, active, onRecord } = args;
  const selectionKey = useMemo(() => resolveScheduleDataSelectionKey(draft), [draft]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // 讀最新的草稿與回呼，但不因它們變動而重跑（只有選取內容變了才重跑）
  const runCheck = useEffectEvent(() => checkDraftScheduleData(draft));
  const deliver = useEffectEvent((record: ScheduleDataCheckRecord) => onRecord(record));

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    // 連續改路線時只跑最後一次
    const timer = window.setTimeout(() => {
      setRunning(true);
      setError(null);
      void runCheck()
        .then((record) => {
          if (!cancelled) deliver(record);
        })
        .catch((failure) => {
          if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
        })
        .finally(() => {
          if (!cancelled) setRunning(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, selectionKey, nonce]);

  const record = draft.routeGroups.dataCheck ?? null;
  const current = record != null && record.selectionKey === selectionKey;
  return {
    running,
    error,
    record: current ? record : null,
    /** 可以往下一步：這一份選取內容檢查過、而且通過 */
    passed: !running && current && record.ok,
    recheck: () => setNonce((value) => value + 1),
  };
}

export type ScheduleDataCheckState = ReturnType<typeof useScheduleDataCheck>;
