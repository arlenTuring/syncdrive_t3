import { AlertCircle, ClipboardCheck, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import {
  buildAttributeIntervalLegends,
  parseStoredTemplateBody,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type ScheduleTask,
} from '../../time-templates/types/editor';
import { AttributeLegendBadgeChip } from '../../time-templates/components/AttributeLegendBadgeChip';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import type { ShiftScheduleCreateDraft } from '../types/create';
import type { ShiftScheduleStoredOutput } from '../utils/shiftScheduleEngine.types';
import { ShiftSchedulePlanGrid } from './ShiftSchedulePlanGrid';

type PreviewTab = 'schedule' | 'capacity';

function MaintenanceBindingSummary({
  binding,
}: {
  binding: ShiftScheduleStoredOutput['maintenanceTaskBinding'];
}) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-zinc-100">
            整備任務已綁定：
            <span className="ml-1 text-emerald-300">{binding.taskName || binding.taskId}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            綁定時間 {new Date(binding.boundAt).toLocaleString('zh-TW')}
            {binding.publishStatus ? ` · 發布狀態 ${binding.publishStatus}` : ''}
            {binding.body ? ' · 規則包完整 body 已寫入班表產出' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

type StepShiftSchedulePreviewProps = {
  draft: ShiftScheduleCreateDraft;
};

export function StepShiftSchedulePreview({ draft }: StepShiftSchedulePreviewProps) {
  const output = draft.scheduleOutput;
  const [activeTab, setActiveTab] = useState<PreviewTab>('schedule');
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);

  useEffect(() => {
    const templateId = output?.timeTemplateRef.templateId ?? draft.timeTemplate.templateId;
    if (!templateId.trim()) {
      setIntervals([]);
      setAttributes([]);
      setTemplateLoading(false);
      return;
    }

    let cancelled = false;
    setTemplateLoading(true);
    void fetchTimeTemplateDetail(templateId)
      .then((detail) => {
        if (cancelled) return;
        const template = parseStoredTemplateBody(detail.body ?? {});
        setIntervals(template.intervals.filter((slot) => !slot.isDraft));
        setAttributes(template.attributes.filter((attr) => !attr.isDraft));
        setTemplateTasks(
          template.tasks.filter(
            (t) => t.rowIndex >= 1 && t.rowIndex <= template.scheduleRowCount,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setIntervals([]);
          setAttributes([]);
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.timeTemplate.templateId, output?.timeTemplateRef.templateId]);

  const periodLegends = useMemo(
    () => buildAttributeIntervalLegends(intervals, attributes),
    [attributes, intervals],
  );

  if (!output) {
    return (
      <PanelNoData
        message="尚無班表產出，請先回到「調整班表」步驟完成生成"
        className="min-h-[240px]"
      />
    );
  }

  const report = output.feasibilityReport;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-4 shrink-0 text-base font-medium text-zinc-100">
        確認班表細節並完成建立
      </h2>

      <div className="mb-4 shrink-0">
        <MaintenanceBindingSummary binding={output.maintenanceTaskBinding} />
      </div>

      {!report.ok && (
        <div className="mb-4 space-y-2">
          {report.errors.map((issue) => (
            <div
              key={`${issue.code}-${issue.message}`}
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex shrink-0 gap-1 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            activeTab === 'schedule'
              ? 'bg-[#2B7FFF] text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          班次預覽
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('capacity')}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            activeTab === 'capacity'
              ? 'bg-[#2B7FFF] text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          運能趨勢
        </button>
      </div>

      {periodLegends.length > 0 && activeTab === 'schedule' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {periodLegends.map((item) => (
            <AttributeLegendBadgeChip key={item.attributeId} item={item} />
          ))}
        </div>
      )}

      {activeTab === 'schedule' ? (
        templateLoading ? (
          <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
            <Loader2 className="size-5 animate-spin" />
            載入班表預覽…
          </div>
        ) : output.plan ? (
          <ShiftSchedulePlanGrid
            plan={output.plan}
            intervals={intervals}
            attributes={attributes}
            templateTasks={templateTasks}
          />
        ) : (
          <PanelNoData message="班表產出缺少班次資料" className="min-h-[240px]" />
        )
      ) : (
        <div className="flex min-h-[240px] flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800/80 bg-zinc-950/30 text-sm text-zinc-500">
          運能趨勢圖表將於後續版本提供
        </div>
      )}
    </div>
  );
}
