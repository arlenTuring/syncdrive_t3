import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  FENCE_BEHAVIOR_OPTIONS,
  type FenceBehaviorKind,
  type FenceDraft,
} from '../types';
import { Button, Checkbox, IconButton, Switch, InputNumber, fieldClass } from '../../../components/ui';

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
    <p className="mb-1.5 text-body-xs tracking-[0.3px] text-text-tertiary">
      {children}
      <span className="ml-0.5 text-status-error-emphasis">*</span>
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
    <div className="space-y-2 rounded-lg border border-border-quaternary bg-surface-secondary px-3 py-2.5">
      <p className="text-body-xs-bold text-text-secondary">{title}</p>
      <div className="flex flex-col gap-2">
        {FENCE_BEHAVIOR_OPTIONS.map((opt) => {
          const checked = selected.includes(opt.id);
          return (
            <label
              key={opt.id}
              className="flex cursor-pointer items-center gap-2 text-body-s text-text-primary"
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(opt.id)} />
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
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-border-quaternary bg-surface-primary">
      <div className="flex shrink-0 items-center justify-between border-b border-border-quaternary px-4 py-3">
        <p className="text-body-s-bold text-text-primary">
          {mode === 'create'
            ? t('virtualFence.form.createTitle')
            : t('virtualFence.form.editTitle')}
        </p>
        <IconButton hierarchy="subordinate" variant="standard" onPress={onClose} title={t('common.close')} label={t('common.close')} icon={<X />} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <RequiredLabel>{t('virtualFence.form.name')}</RequiredLabel>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t('virtualFence.form.inputPlaceholder')}
            className={fieldClass({ size: 'md', fullWidth: true })}
          />
        </div>

        <div>
          <RequiredLabel>{t('virtualFence.form.coverage')}</RequiredLabel>
          <div className="min-h-9 rounded-lg border border-border-quaternary bg-surface-secondary px-2 py-1.5">
            {draft.coverage.length === 0 ? (
              <p className="px-1 py-1 text-body-s text-text-quaternary">
                {draft.vertices.length >= 3
                  ? t('virtualFence.form.coverageEmptyDrawn')
                  : t('virtualFence.form.coverageEmptyHint')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {draft.coverage.map((seg) => (
                  <span
                    key={seg.trackId}
                    className="inline-flex items-center gap-1 rounded-md border border-border-tertiary bg-surface-secondary px-2 py-0.5 text-body-xs text-text-primary"
                  >
                    {seg.label}
                    <Button hierarchy="subordinate" variant="text" onPress={() => removeCoverage(seg.trackId)} aria-label={t('virtualFence.form.removeCoverage', {
                        label: seg.label,
                      })}>×</Button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <RequiredLabel>{t('virtualFence.form.enable')}</RequiredLabel>
          <Switch checked={draft.enabled} aria-label={t('virtualFence.form.enable')} onCheckedChange={(enabled) => onChange({ ...draft, enabled })} />
        </div>

        <div className="space-y-2">
          <RequiredLabel>{t('virtualFence.form.behaviors')}</RequiredLabel>
          <p className="text-body-xs text-text-quaternary">
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
              <InputNumber
                ariaLabel={t('virtualFence.form.speedLimit')}
                min={0}
                step={1}
                value={draft.speedLimitKmh ?? null}
                onChange={(next) => onChange({ ...draft, speedLimitKmh: next })}
                fluid={false}
                className="w-32"
              />
              <span className="text-body-s text-text-tertiary">
                {t('virtualFence.form.speedUnit')}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border-quaternary px-4 py-3">
        <Button hierarchy="subordinate" variant="tonal" onPress={onCancel}>{mode === 'create'
            ? t('virtualFence.form.discard')
            : t('common.cancel')}</Button>
        <Button disabled={!canSubmit} onPress={onSubmit}>{mode === 'create'
            ? t('virtualFence.form.createAction')
            : t('common.save')}</Button>
      </div>
    </aside>
  );
}
