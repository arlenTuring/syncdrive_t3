import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchTimeTemplateDetail, fetchTimeTemplateList } from '../../time-templates/api/timeTemplatesApi';
import { StepOverallPreview } from '../../time-templates/components/StepOverallPreview';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import type { TimeTemplateListItem } from '../../time-templates/types';
import type {
  ShiftScheduleCreationMode,
  ShiftScheduleTimeTemplateDraft,
} from '../types/create';
import { templateHasEmptyAttributePeriods } from '../utils/emptyAttributeIntervals';
import {
  normalizeEmptyIntervalMainlineSlackSecondsInput,
} from '../utils/resolveMaintenanceEntrySlackSeconds';
import { HelpTip } from './HelpTip';
import { MainlineSlackSecondsField } from './MainlineSlackSecondsField';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';

const SELECT_CLASS =
  'h-[42px] w-full min-w-0 flex-1 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]';

type StepShiftTimeTemplateProps = {
  draft: ShiftScheduleTimeTemplateDraft;
  creationMode?: ShiftScheduleCreationMode;
  onChange: (next: ShiftScheduleTimeTemplateDraft) => void;
};

export function StepShiftTimeTemplate({
  draft,
  creationMode = 'parametric',
  onChange,
}: StepShiftTimeTemplateProps) {
  const [items, setItems] = useState<TimeTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [previewData, setPreviewData] = useState(() => parseStoredTemplateBody({}));

  const hasEmptyIntervals = useMemo(
    () => templateHasEmptyAttributePeriods(previewData.intervals),
    [previewData.intervals],
  );

  /**
   * P2：高密度時段屬性算出最短班距（排除 draft 與無效屬性）。
   * 如果有任何 ≤ 300 秒（5 分鐘）的屬性，顯示高密度預警。
   */
  const highDensityAttrs = useMemo(() => {
    return previewData.attributes
      .filter(
        (attr) =>
          !attr.isDraft
          && attr.headwaySeconds != null
          && attr.headwaySeconds > 0
          && attr.headwaySeconds <= 300,
      )
      .sort((a, b) => (a.headwaySeconds ?? 0) - (b.headwaySeconds ?? 0));
  }, [previewData.attributes]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTimeTemplateList({
      page: 1,
      page_size: 100,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draft.templateId) {
      setPreviewName('');
      setPreviewData(parseStoredTemplateBody({}));
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void fetchTimeTemplateDetail(draft.templateId)
      .then((detail) => {
        if (cancelled) return;
        setPreviewName(detail.name || draft.templateName);
        setPreviewData(parseStoredTemplateBody(detail.body ?? {}));
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : String(e));
          setPreviewName('');
          setPreviewData(parseStoredTemplateBody({}));
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.templateId, draft.templateName]);

  const handleSelect = (templateId: string) => {
    const item = items.find((row) => row.template_id === templateId);
    onChange({
      ...draft,
      templateId,
      templateName: item?.name ?? '',
      emptyIntervalMainlineSlackSeconds: normalizeEmptyIntervalMainlineSlackSecondsInput(
        undefined,
      ),
    });
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <h2 className="mb-6 shrink-0 text-base font-medium text-zinc-100">選擇要套用的時間模板</h2>

      <div className="max-w-4xl shrink-0">
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
            時間模板
          </span>
          {loading ? (
            <div className="flex h-[42px] items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" />
              載入時間模板中…
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <select
                value={draft.templateId}
                onChange={(e) => handleSelect(e.target.value)}
                className={SELECT_CLASS}
                disabled={Boolean(error) || items.length === 0}
              >
                <option value="">請選擇</option>
                {items.map((item) => (
                  <option key={item.template_id} value={item.template_id}>
                    {item.name}
                    {item.publish_status === 'draft' ? `（${item.publish_status_label}）` : ''}
                  </option>
                ))}
              </select>
              {draft.templateId
                && !previewLoading
                && !previewError
                && highDensityAttrs.length > 0 ? (
                <p className="flex max-w-[min(100%,22rem)] shrink-0 items-center gap-1.5 text-sm font-medium text-amber-200">
                  <span className="min-w-0 leading-snug">
                    此模板含有高密度時段，建議增加時間線列數
                  </span>
                  <HelpTip
                    label="高密度時段說明"
                    widthClass="w-72"
                    side="bottom"
                  >
                    <p>
                      以下時段屬性班距較短，一輛車的完整交路週期可能超過班距，
                      導致單車跑不完一整輪而出現「未承接班距」警告。
                      請在 Step 2 確認時間線列數是否足夠（通常需要 ≥ 週期÷班距 輛車）。
                    </p>
                    <ul className="mt-2 space-y-1">
                      {highDensityAttrs.map((attr) => (
                        <li key={attr.id} className="flex items-center gap-1.5">
                          <span
                            className="inline-block size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: attr.color }}
                          />
                          <span className="font-medium text-zinc-100">{attr.name}</span>
                          <span className="text-zinc-400">班距 {attr.headwaySeconds} 秒</span>
                        </li>
                      ))}
                    </ul>
                  </HelpTip>
                </p>
              ) : null}
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="mt-2 text-sm text-zinc-500">尚無時間模板可選，請先至「時間模板管理」建立</p>
          )}
        </label>
      </div>

      {draft.templateId
        && creationMode === 'parametric'
        && !previewLoading
        && !previewError
        && hasEmptyIntervals && (
        <div className="mt-6 max-w-3xl shrink-0 space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-5">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">空時段正線讓渡餘裕</h3>
            <p className="mt-1 text-xs text-zinc-500">
              此模板在 00:00–24:00 內有未排定時間屬性的空時段；正線結束後可占用空時段開頭，不可提前占用空時段尾端。改動後需重新生成班表。
            </p>
          </div>
          <MainlineSlackSecondsField
            label="空時段正線讓渡餘裕"
            value={normalizeEmptyIntervalMainlineSlackSecondsInput(
              draft.emptyIntervalMainlineSlackSeconds,
            )}
            onChange={(emptyIntervalMainlineSlackSeconds) =>
              onChange({
                ...draft,
                emptyIntervalMainlineSlackSeconds,
              })
            }
            prefixText="正線結束後可占用空時段開頭，最多"
          />
        </div>
      )}

      <div className="mt-8 flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
        {!draft.templateId ? (
          <ShiftSelectionEmptyState />
        ) : previewLoading ? (
          <div className="flex min-h-[280px] flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            載入時間模板預覽中…
          </div>
        ) : previewError ? (
          <div className="flex min-h-[280px] flex-1 items-center justify-center px-6 text-sm text-red-400">
            {previewError}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
            <StepOverallPreview
              name={previewName}
              intervals={previewData.intervals}
              attributes={previewData.attributes}
              tasks={previewData.tasks}
              rowCount={previewData.scheduleRowCount}
              emptyHint="此模板尚無班表資料"
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  );
}
