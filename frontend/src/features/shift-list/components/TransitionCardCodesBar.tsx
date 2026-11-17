import { Lightbulb } from 'lucide-react';
import type { MaintenanceSectionCodeBySection, MaintenanceSectionCodeKey } from '../utils/maintenanceSectionCode';
import {
  TRANSITION_CARD_CODE_KEYS,
  TRANSITION_CARD_CODE_META,
  emptyTransitionCardCodes,
  findCardCodeConfigIssues,
  isTransitionCardCodeRequired,
  isValidCardCode,
  normalizeCardCode,
  type TransitionCardCodeKey,
  type TransitionCardCodes,
} from '../utils/cardCode';
import { Button } from '../../../components/ui';

/**
 * 路線群組步驟的「過渡卡代號」：入場、出場、暫停／停留各一個 1～2 個大寫英文字母。
 * 班次代號＝代號＋列號＋計畫開始 HHMM（例 IN020830），規則見 utils/cardCode.ts。
 *
 * 待命不在這裡：它是整備區塊，用整備任務步驟的代號。舊班表沒有這一欄時照舊代號顯示並標示待補設定，
 * 使用者按「開始設定」才改用新規則。
 */
export function TransitionCardCodesBar({
  codes,
  onChange,
  maintenanceSkipped,
  sectionCodes,
  sectionEnabled,
  routeCodes,
}: {
  codes: TransitionCardCodes | null;
  onChange: (next: TransitionCardCodes) => void;
  maintenanceSkipped: boolean;
  sectionCodes: MaintenanceSectionCodeBySection | null;
  sectionEnabled: Partial<Record<MaintenanceSectionCodeKey, boolean>>;
  routeCodes: ReadonlyArray<string | null | undefined>;
}) {
  if (!codes) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-warning-light bg-status-warning-light px-4 py-3"
        data-transition-card-codes="pending"
      >
        <div className="text-body-s text-status-warning">
          <span className="font-medium">過渡卡代號：待補設定。</span>
          <span className="text-status-warning">
            這份班表建立時還沒有這項設定，整備與過渡卡目前照舊代號顯示（已執行的訂單不受影響）。
          </span>
        </div>
        <Button hierarchy="subordinate" variant="outlined" onPress={() => onChange(emptyTransitionCardCodes())}>開始設定</Button>
      </div>
    );
  }

  const issues = findCardCodeConfigIssues({
    sectionCodes,
    sectionEnabled,
    transitionCodes: codes,
    maintenanceSkipped,
    routeCodes,
  });
  const issuesFor = (key: TransitionCardCodeKey) => issues.filter((issue) => issue.key === key);

  return (
    <div className="rounded-xl bg-surface-secondary px-5 py-4" data-transition-card-codes="set">
      <h3 className="text-body-m-bold text-text-primary">過渡卡代號</h3>
      <div className="mt-4 grid gap-2 rounded-lg bg-surface-primary px-4 py-2.5 text-body-s text-text-secondary md:grid-cols-2" title="待命用整備任務的代號">
        <p className="flex items-center gap-1.5">
          <Lightbulb className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          輸入代號<span className="text-text-disabled" aria-hidden>｜</span>1～2 個大寫英文字母
        </p>
        <p className="flex items-center gap-1.5">
          <Lightbulb className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          班次代號<span className="text-text-disabled" aria-hidden>｜</span>代號 + 列號 + 計畫開始時間 (HHMM)
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {TRANSITION_CARD_CODE_KEYS.map((key) => {
          const meta = TRANSITION_CARD_CODE_META[key];
          const value = codes[key];
          const required = isTransitionCardCodeRequired(key, maintenanceSkipped);
          const fieldIssues = issuesFor(key);
          return (
            <label key={key} className="block min-w-0">
              <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary" title={meta.description}>
                {required ? <span className="text-status-error-emphasis">*</span> : null}
                {meta.label === '暫停 / 停留' || meta.label === '暫停／停留' ? '停留' : meta.label}
              </span>
              <input
                type="text"
                value={value}
                maxLength={4}
                onChange={(e) => onChange({ ...codes, [key]: e.target.value.toUpperCase() })}
                onBlur={() => onChange({ ...codes, [key]: normalizeCardCode(value) })}
                placeholder="請輸入"
                aria-label={`${meta.label}代號`}
                aria-invalid={fieldIssues.length > 0}
                data-transition-code={key}
                className={`h-9 w-full rounded-lg border bg-link-standard-hover px-3 text-body-s tracking-wider text-text-primary placeholder:text-text-quaternary focus:outline-none focus:ring-1 ${
                  fieldIssues.length > 0
                    ? 'border-red-500/70 focus:border-status-error focus:ring-red-500'
                    : 'border-transparent focus:border-border-theme focus:ring-border-theme'
                }`}
              />
              <span className="mt-1.5 block px-1 text-body-xs text-text-tertiary">
                預覽：{isValidCardCode(normalizeCardCode(value)) ? `${normalizeCardCode(value)}011030` : '尚未填入代號'}
              </span>
              {fieldIssues.map((issue) => (
                <span key={issue.message} className="mt-1 block text-body-xs text-status-error-emphasis" data-transition-code-issue={key}>
                  {issue.message}
                </span>
              ))}
            </label>
          );
        })}
      </div>
      {issues.filter((issue) => !issue.key).map((issue) => (
        <p key={issue.message} className="mt-2 text-body-xs text-status-error-emphasis">
          {issue.message}
        </p>
      ))}
    </div>
  );
}
