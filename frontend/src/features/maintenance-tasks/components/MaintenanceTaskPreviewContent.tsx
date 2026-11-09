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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
            {t('maintenanceTasks.previewChrome.edit')}
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
            {enabled
              ? t('maintenanceTasks.previewChrome.enabled')
              : t('maintenanceTasks.previewChrome.disabled')}
          </span>
        )}
      </header>

      <div className="px-5 py-4">
        {showSkipped ? (
          <p className="text-sm text-zinc-600">{t('maintenanceTasks.stepSkipped')}</p>
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

type SectionKey = 'charging' | 'carWash' | 'maintenance' | 'preTrip' | 'mobile';
type SectionLines = { enabled: boolean; conditions: string[]; facilities: string[] };

/**
 * 各整備區段的「條件」與「設施」兩組文字。
 * omitEmptyChargeRate：沒填每分鐘充電率時不帶充電率（建立班表精靈）；否則顯示「—」。
 */
function buildSectionLines(
  draft: MaintenanceTaskCreateDraft,
  t: ReturnType<typeof useTranslation>['t'],
  { omitEmptyChargeRate = false }: { omitEmptyChargeRate?: boolean } = {},
): Record<SectionKey, SectionLines> {
  const charging = normalizeChargingDraft(draft.charging);
  const carWash = normalizeCarWashDraft(draft.carWash);
  const maintenance = normalizeMaintenanceDraft(draft.maintenance);
  const preTrip = normalizePreTripDraft(draft.preTrip);
  const mobile = normalizeMobileDraft(draft.mobile);
  const facilities = (rows: ReadonlyArray<Parameters<typeof formatEquipmentRowPreviewLine>[0]>) =>
    rows.filter((row) => row.mapCode).map((row) => formatEquipmentRowPreviewLine(row));

  const chargingConditions: string[] = [];
  if (charging.stepEnabled && charging.triggerPercent) {
    chargingConditions.push(t('maintenanceTasks.charging.triggerPreview', { percent: charging.triggerPercent }));
  }
  if (charging.stepEnabled && charging.upperLimitDetectionEnabled && charging.upperLimitPercent) {
    chargingConditions.push(t('maintenanceTasks.charging.upperPreview', { percent: charging.upperLimitPercent }));
  }
  const chargingFacilities = charging.equipmentRows
    .filter((row) => row.mapCode)
    .map((row) => {
      const rate = String(row.chargeRateKwhPerMin ?? '').trim();
      if (!rate && omitEmptyChargeRate) return formatEquipmentRowPreviewLine(row);
      return formatEquipmentRowPreviewLine(row, t('maintenanceTasks.charging.chargeRatePreview', { rate: rate || '—' }));
    });

  const carWashConditions: string[] = [];
  if (carWash.mileageDetectionEnabled && carWash.mileageTriggerKm) {
    carWashConditions.push(t('maintenanceTasks.carWash.mileagePreview', { km: carWash.mileageTriggerKm }));
  }
  if (carWash.timeDetectionEnabled && carWash.timeTriggerHours) {
    carWashConditions.push(t('maintenanceTasks.carWash.timePreview', { hours: carWash.timeTriggerHours }));
  }
  if (carWash.operationDurationMinutes) {
    carWashConditions.push(t('maintenanceTasks.carWash.durationPreview', { minutes: carWash.operationDurationMinutes }));
  }

  return {
    charging: { enabled: charging.stepEnabled, conditions: chargingConditions, facilities: chargingFacilities },
    carWash: { enabled: carWash.stepEnabled, conditions: carWashConditions, facilities: facilities(carWash.equipmentRows) },
    maintenance: {
      enabled: maintenance.stepEnabled,
      conditions: maintenance.cycleConditions.map(formatMaintenanceCycleCondition),
      facilities: facilities(maintenance.equipmentRows),
    },
    preTrip: {
      enabled: preTrip.stepEnabled,
      conditions: preTrip.operationDurationMinutes
        ? [t('maintenanceTasks.preTrip.durationLine', { minutes: preTrip.operationDurationMinutes })]
        : [],
      facilities: facilities(preTrip.equipmentRows),
    },
    mobile: {
      enabled: mobile.stepEnabled,
      conditions: mobile.durationFollowTemplate !== false
        ? [t('maintenanceTasks.mobile.durationFollowSchedule')]
        : mobile.operationDurationMinutes
          ? [t('maintenanceTasks.mobile.durationLine', { minutes: mobile.operationDurationMinutes })]
          : [],
      facilities: facilities(mobile.equipmentRows),
    },
  };
}

type MaintenanceTaskPreviewContentProps = {
  draft: MaintenanceTaskCreateDraft;
  onEditStep?: (step: CreateMaintenanceTaskStep) => void;
  /**
   * 班表 Step 2 用：插入各整備區塊內容頂部（例如正線優先讓渡餘裕）。
   * key 對應充電／洗車／保養／行檢／待命。
   */
  sectionExtras?: Partial<Record<SectionKey, ReactNode>>;
  /** wizard：建立班表精靈的設計稿外觀（灰底卡片、條件設定與營運設施分開、只列啟用的區段） */
  appearance?: 'default' | 'wizard';
};

const SECTION_ORDER: Array<{ key: SectionKey; step: number }> = [
  { key: 'charging', step: 2 },
  { key: 'carWash', step: 3 },
  { key: 'maintenance', step: 4 },
  { key: 'preTrip', step: 5 },
  { key: 'mobile', step: 6 },
];

function WizardBulletCard({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg bg-[#1b1b1f] px-4 py-3">
      <h4 className="mb-2 text-sm font-medium text-zinc-100">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="flex gap-2 text-sm text-zinc-200">
            <span className="shrink-0 text-zinc-500" aria-hidden>•</span>
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MaintenanceTaskPreviewContent({
  draft,
  onEditStep,
  sectionExtras,
  appearance = 'default',
}: MaintenanceTaskPreviewContentProps) {
  const { t } = useTranslation();
  const lines = buildSectionLines(draft, t, { omitEmptyChargeRate: appearance === 'wizard' });

  const stepLabels = Object.fromEntries(
    CREATE_MAINTENANCE_TASK_STEPS.map((s) => [
      s.step,
      t(`maintenanceTasks.createWizard.steps.${s.step}`),
    ]),
  ) as Record<number, string>;

  const basicRows = (
    <dl className="space-y-3">
      <PreviewRow label={t('maintenanceTasks.previewChrome.basicName')} value={draft.basic.name.trim() || '—'} />
      <PreviewRow label={t('maintenanceTasks.previewChrome.version')} value={draft.basic.version.trim() || '—'} />
      <PreviewRow label={t('maintenanceTasks.previewChrome.remarks')} value={draft.basic.remarks.trim() || '—'} />
    </dl>
  );

  if (appearance === 'wizard') {
    return (
      <div className="space-y-4">
        <section className="rounded-xl bg-[#232329] px-5 py-5">
          <h3 className="mb-4 text-base font-medium text-zinc-100">{stepLabels[1]}</h3>
          {basicRows}
        </section>
        {SECTION_ORDER.filter(({ key }) => lines[key].enabled).map(({ key, step }) => (
          <section key={key} className="space-y-4 rounded-xl bg-[#232329] px-5 py-5">
            <h3 className="text-base font-medium text-zinc-100">{stepLabels[step]}</h3>
            {sectionExtras?.[key]}
            <WizardBulletCard title="條件設定" items={lines[key].conditions} />
            <WizardBulletCard title="營運設施" items={lines[key].facilities} />
          </section>
        ))}
      </div>
    );
  }

  const wrapSection = (extra: ReactNode | undefined, body: ReactNode) => {
    if (!extra) return body;
    return (
      <div className="space-y-4">
        {extra}
        {body}
      </div>
    );
  };
  // 原本的預覽順序：充電與洗車先條件後設施；保養、行檢、待命先設施後條件
  const ordered = (key: SectionKey) =>
    key === 'charging' || key === 'carWash'
      ? [...lines[key].conditions, ...lines[key].facilities]
      : [...lines[key].facilities, ...lines[key].conditions];

  return (
    <div className="space-y-4">
      <PreviewSection step={1} title={stepLabels[1]} onEdit={onEditStep}>
        {basicRows}
      </PreviewSection>
      {SECTION_ORDER.map(({ key, step }) => (
        <PreviewSection key={key} step={step} title={stepLabels[step]} enabled={lines[key].enabled} onEdit={onEditStep}>
          {wrapSection(
            lines[key].enabled ? sectionExtras?.[key] : undefined,
            <PreviewList items={ordered(key)} />,
          )}
        </PreviewSection>
      ))}
    </div>
  );
}
