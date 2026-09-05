import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  FENCE_BEHAVIOR_OPTIONS,
  type FenceBehaviorKind,
  type FenceDraft,
} from '../types';

type FenceFormPanelProps = {
  mode: 'edit' | 'create';
  draft: FenceDraft;
  onChange: (next: FenceDraft) => void;
  onClose: () => void;
  onCancel: () => void;
  onSubmit: () => void;
};

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs tracking-[0.3px] text-zinc-400">
      {children}
      <span className="ml-0.5 text-red-400">*</span>
    </p>
  );
}

function toggleBehavior(
  list: FenceBehaviorKind[],
  kind: FenceBehaviorKind,
): FenceBehaviorKind[] {
  return list.includes(kind) ? list.filter((x) => x !== kind) : [...list, kind];
}

function BehaviorGroup({
  title,
  selected,
  onToggle,
}: {
  title: string;
  selected: FenceBehaviorKind[];
  onToggle: (kind: FenceBehaviorKind) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-zinc-700/60 bg-[#27272a] px-3 py-2.5">
      <p className="text-xs font-medium text-zinc-300">{title}</p>
      <div className="flex flex-col gap-2">
        {FENCE_BEHAVIOR_OPTIONS.map((opt) => {
          const checked = selected.includes(opt.id);
          return (
            <label
              key={opt.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(opt.id)}
                className="size-3.5 rounded border-zinc-600 bg-zinc-900 text-[#2B7FFF] focus:ring-[#2B7FFF]/40"
              />
              {t(`virtualFence.behavior.${opt.id}`)}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function FenceFormPanel({
  mode,
  draft,
  onChange,
  onClose,
  onCancel,
  onSubmit,
}: FenceFormPanelProps) {
  const { t } = useTranslation();
  const canSubmit =
    draft.name.trim().length > 0
    && draft.vertices.length >= 3;

  const needsSpeed =
    draft.enterBehaviors.includes('speed_limit')
    || draft.leaveBehaviors.includes('speed_limit');

  const removeCoverage = (trackId: string) => {
    onChange({
      ...draft,
      coverage: draft.coverage.filter((c) => c.trackId !== trackId),
    });
  };

  return (
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-zinc-800/80 bg-[#1c1c1f]">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-4 py-3">
        <p className="text-sm font-medium text-zinc-100">
          {mode === 'create'
            ? t('virtualFence.form.createTitle')
            : t('virtualFence.form.editTitle')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title={t('common.close')}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <RequiredLabel>{t('virtualFence.form.name')}</RequiredLabel>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t('virtualFence.form.inputPlaceholder')}
            className="h-9 w-full rounded-lg border border-zinc-700/60 bg-[#27272a] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF]/60"
          />
        </div>

        <div>
          <RequiredLabel>{t('virtualFence.form.coverage')}</RequiredLabel>
          <div className="min-h-9 rounded-lg border border-zinc-700/60 bg-[#27272a] px-2 py-1.5">
            {draft.coverage.length === 0 ? (
              <p className="px-1 py-1 text-sm text-zinc-500">
                {draft.vertices.length >= 3
                  ? t('virtualFence.form.coverageEmptyDrawn')
                  : t('virtualFence.form.coverageEmptyHint')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {draft.coverage.map((seg) => (
                  <span
                    key={seg.trackId}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-xs text-zinc-100"
                  >
                    {seg.label}
                    <button
                      type="button"
                      onClick={() => removeCoverage(seg.trackId)}
                      className="text-zinc-400 hover:text-white"
                      aria-label={t('virtualFence.form.removeCoverage', {
                        label: seg.label,
                      })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <RequiredLabel>{t('virtualFence.form.enable')}</RequiredLabel>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => onChange({ ...draft, enabled: !draft.enabled })}
            className={`relative h-6 w-11 rounded-full transition ${
              draft.enabled ? 'bg-[#2B7FFF]' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white transition ${
                draft.enabled ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        <div className="space-y-2">
          <RequiredLabel>{t('virtualFence.form.behaviors')}</RequiredLabel>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            {t('virtualFence.form.behaviorsHint')}
          </p>
          <BehaviorGroup
            title={t('virtualFence.form.enter')}
            selected={draft.enterBehaviors}
            onToggle={(kind) =>
              onChange({
                ...draft,
                enterBehaviors: toggleBehavior(draft.enterBehaviors, kind),
              })
            }
          />
          <BehaviorGroup
            title={t('virtualFence.form.leave')}
            selected={draft.leaveBehaviors}
            onToggle={(kind) =>
              onChange({
                ...draft,
                leaveBehaviors: toggleBehavior(draft.leaveBehaviors, kind),
              })
            }
          />
        </div>

        {needsSpeed ? (
          <div>
            <RequiredLabel>{t('virtualFence.form.speedLimit')}</RequiredLabel>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={draft.speedLimitKmh ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange({
                    ...draft,
                    speedLimitKmh: Number.isFinite(n) ? n : null,
                  });
                }}
                className="h-9 w-24 rounded-lg border border-zinc-700/60 bg-[#27272a] px-3 text-sm text-zinc-100 outline-none focus:border-[#2B7FFF]/60"
              />
              <span className="text-sm text-zinc-400">
                {t('virtualFence.form.speedUnit')}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-800/60 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-2 text-sm text-zinc-300 transition hover:text-white"
        >
          {mode === 'create'
            ? t('virtualFence.form.discard')
            : t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-[#2B7FFF] px-5 text-sm font-medium text-white transition hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {mode === 'create'
            ? t('virtualFence.form.createAction')
            : t('common.save')}
        </button>
      </div>
    </aside>
  );
}
