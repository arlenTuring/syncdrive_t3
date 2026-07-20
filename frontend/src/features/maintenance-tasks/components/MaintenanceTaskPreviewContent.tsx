import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import {
  CREATE_MAINTENANCE_TASK_STEPS,
  formatEquipmentRowPreviewLine,
  formatMaintenanceCycleCondition,
  normalizeCarWashDraft,
  normalizeChargingDraft,
  normalizeMaintenanceDraft,
  normalizeMobileDraft,
  normalizePreTripDraft,
  type CreateMaintenanceTaskStep,
  type MaintenanceTaskCreateDraft,
} from '../types/create';
import { MAINTENANCE_STEP_SKIPPED_MESSAGE } from './StepSectionToggle';

export function PreviewSection({
  step,
  title,
  enabled,
  onEdit,
  children,
}: {
  step: number;
  title: string;
  enabled?: boolean;
  onEdit?: (step: CreateMaintenanceTaskStep) => void;
  children: ReactNode;
}) {
  const showSkipped = enabled === false;

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/30">
      <header className="flex items-center gap-3 border-b border-zinc-800/60 bg-zinc-900/50 px-5 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-400">
          {step}
        </span>
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(step as CreateMaintenanceTaskStep)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Pencil className="size-3" />
            編輯
          </button>
        )}
        {enabled !== undefined && (
          <span
            className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              enabled
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {enabled ? '已啟用' : '未啟用'}
          </span>
        )}
      </header>

      <div className="px-5 py-4">
        {showSkipped ? (
          <p className="text-sm text-zinc-600">{MAINTENANCE_STEP_SKIPPED_MESSAGE}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function PreviewRow({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`min-w-0 break-words ${empty ? 'text-zinc-600' : 'text-zinc-200'}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  );
}

export function PreviewList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-600">—</p>;
  }
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${index}-${item}`}
          className="flex gap-2 text-sm text-zinc-200"
        >
          <span className="shrink-0 tabular-nums text-zinc-500">{index + 1}.</span>
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ol>
  );
}

type MaintenanceTaskPreviewContentProps = {
  draft: MaintenanceTaskCreateDraft;
  onEditStep?: (step: CreateMaintenanceTaskStep) => void;
  /**
   * 班表 Step 2 用：插入各整備區塊內容頂部（例如正線優先讓渡餘裕）。
   * key 對應充電／洗車／保養／行前／機動。
   */
  sectionExtras?: Partial<{
    charging: ReactNode;
    carWash: ReactNode;
    maintenance: ReactNode;
    preTrip: ReactNode;
    mobile: ReactNode;
  }>;
};

export function MaintenanceTaskPreviewContent({
  draft,
  onEditStep,
  sectionExtras,
}: MaintenanceTaskPreviewContentProps) {
  const charging = normalizeChargingDraft(draft.charging);
  const carWash = normalizeCarWashDraft(draft.carWash);
  const maintenance = normalizeMaintenanceDraft(draft.maintenance);
  const preTrip = normalizePreTripDraft(draft.preTrip);
  const mobile = normalizeMobileDraft(draft.mobile);

  const chargingLines: string[] = [];
  if (charging.stepEnabled && charging.triggerPercent) {
    chargingLines.push(
      `如電池電量已小於或等於 ${charging.triggerPercent}% 時，需回廠充電`,
    );
  }
  if (charging.stepEnabled && charging.upperLimitDetectionEnabled && charging.upperLimitPercent) {
    chargingLines.push(
      `如電池電量已大於或等於 ${charging.upperLimitPercent}% 時，即停止充電`,
    );
  }
  for (const row of charging.equipmentRows) {
    if (row.mapCode) {
      chargingLines.push(
        formatEquipmentRowPreviewLine(
          row,
          `每分鐘充電率 ${row.chargeRateKwhPerMin || '—'} 度電/分鐘`,
        ),
      );
    }
  }

  const carWashLines: string[] = [];
  if (carWash.mileageDetectionEnabled && carWash.mileageTriggerKm) {
    carWashLines.push(
      `每經過 ${carWash.mileageTriggerKm} 公里的行駛里程，需進行洗車作業`,
    );
  }
  if (carWash.timeDetectionEnabled && carWash.timeTriggerHours) {
    carWashLines.push(
      `每經過 ${carWash.timeTriggerHours} 小時的行駛時數，需進行洗車作業`,
    );
  }
  if (carWash.operationDurationMinutes) {
    carWashLines.push(`每次需 ${carWash.operationDurationMinutes} 分鐘，進行洗車作業`);
  }
  for (const row of carWash.equipmentRows) {
    if (row.mapCode) {
      carWashLines.push(formatEquipmentRowPreviewLine(row));
    }
  }

  const maintenanceLines = [
    ...maintenance.equipmentRows
      .filter((row) => row.mapCode)
      .map((row) => formatEquipmentRowPreviewLine(row)),
    ...maintenance.cycleConditions.map(formatMaintenanceCycleCondition),
  ];

  const stepLabels = Object.fromEntries(
    CREATE_MAINTENANCE_TASK_STEPS.map((s) => [s.step, s.label]),
  ) as Record<number, string>;

  const wrapSection = (extra: ReactNode | undefined, body: ReactNode) => {
    if (!extra) return body;
    return (
      <div className="space-y-4">
        {extra}
        {body}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PreviewSection step={1} title={stepLabels[1]} onEdit={onEditStep}>
        <dl className="space-y-3">
          <PreviewRow label="班表名稱" value={draft.basic.name.trim() || '—'} />
          <PreviewRow label="版本編號" value={draft.basic.version.trim() || '—'} />
          <PreviewRow label="備註說明" value={draft.basic.remarks.trim() || '—'} />
        </dl>
      </PreviewSection>

      <PreviewSection step={2} title={stepLabels[2]} enabled={charging.stepEnabled} onEdit={onEditStep}>
        {wrapSection(
          charging.stepEnabled ? sectionExtras?.charging : undefined,
          <PreviewList items={chargingLines} />,
        )}
      </PreviewSection>

      <PreviewSection step={3} title={stepLabels[3]} enabled={carWash.stepEnabled} onEdit={onEditStep}>
        {wrapSection(
          carWash.stepEnabled ? sectionExtras?.carWash : undefined,
          <PreviewList items={carWashLines} />,
        )}
      </PreviewSection>

      <PreviewSection step={4} title={stepLabels[4]} enabled={maintenance.stepEnabled} onEdit={onEditStep}>
        {wrapSection(
          maintenance.stepEnabled ? sectionExtras?.maintenance : undefined,
          <PreviewList items={maintenanceLines} />,
        )}
      </PreviewSection>

      <PreviewSection step={5} title={stepLabels[5]} enabled={preTrip.stepEnabled} onEdit={onEditStep}>
        {wrapSection(
          preTrip.stepEnabled ? sectionExtras?.preTrip : undefined,
          <PreviewList
            items={[
              ...preTrip.equipmentRows
                .filter((row) => row.mapCode)
                .map((row) => formatEquipmentRowPreviewLine(row)),
              ...(preTrip.operationDurationMinutes
                ? [`單次作業時長 ${preTrip.operationDurationMinutes} 分鐘`]
                : []),
            ]}
          />,
        )}
      </PreviewSection>

      <PreviewSection step={6} title={stepLabels[6]} enabled={mobile.stepEnabled} onEdit={onEditStep}>
        {wrapSection(
          mobile.stepEnabled ? sectionExtras?.mobile : undefined,
          <PreviewList
            items={[
              ...mobile.equipmentRows
                .filter((row) => row.mapCode)
                .map((row) => formatEquipmentRowPreviewLine(row)),
              ...(mobile.durationFollowTemplate !== false
                ? ['作業時長：依排班調度決定時長']
                : mobile.operationDurationMinutes
                ? [`單次作業時長 ${mobile.operationDurationMinutes} 分鐘`]
                : []),
            ]}
          />,
        )}
      </PreviewSection>
    </div>
  );
}
