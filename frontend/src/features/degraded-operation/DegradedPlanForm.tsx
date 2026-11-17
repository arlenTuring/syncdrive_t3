import { SiteSelect } from '../../components/SiteSelect';
/* eslint-disable react-refresh/only-export-components -- draft helpers are the form's shared validation contract */
import type { DegradedOperationPlan, DegradedOperationPlanInput } from "./api";
import { Button, Radio } from '../../components/ui';

export type PlanDraft = {
  name: string;
  description: string;
  level: 1 | 2 | 3;
  speedMode: "stopped" | "custom";
  customSpeed: string;
};

export const emptyPlanDraft = (): PlanDraft => ({
  name: "",
  description: "",
  level: 3,
  speedMode: "stopped",
  customSpeed: "20",
});

export const draftFromPlan = (plan: DegradedOperationPlan): PlanDraft => ({
  name: plan.name,
  description: plan.description,
  level: plan.level as 1 | 2 | 3,
  speedMode: plan.speed_limit_kmh === 0 ? "stopped" : "custom",
  customSpeed: plan.speed_limit_kmh === 0 ? "20" : String(plan.speed_limit_kmh),
});

export function planDraftPayload(
  draft: PlanDraft,
): DegradedOperationPlanInput | null {
  const name = draft.name.trim();
  const speed = draft.speedMode === "stopped" ? 0 : Number(draft.customSpeed);
  if (
    !name ||
    ![1, 2, 3].includes(draft.level) ||
    !Number.isFinite(speed) ||
    (draft.speedMode === "custom" && speed <= 0)
  )
    return null;
  return {
    name,
    description: draft.description.trim(),
    level: draft.level,
    speed_limit_kmh: speed,
  };
}

type Props = {
  value: PlanDraft;
  onChange: (value: PlanDraft) => void;
  disabled?: boolean;
  showIdentity?: boolean;
};

const inputClass =
  "w-full rounded-xl border border-transparent bg-[#252b34] px-4 py-3 text-text-primary outline-none transition placeholder:text-text-quaternary focus:border-border-theme disabled:cursor-not-allowed disabled:text-text-quaternary";

export function DegradedPlanForm({
  value,
  onChange,
  disabled,
  showIdentity = true,
}: Props) {
  const patch = (next: Partial<PlanDraft>) => onChange({ ...value, ...next });
  return (
    <div className="space-y-4">
      {showIdentity ? (
        <>
          <label className="block text-body-s text-text-secondary">
            <span className="mb-1.5 block">
              <b className="text-status-error-emphasis">*</b>計畫名稱
            </span>
            <input
              autoFocus
              maxLength={200}
              disabled={disabled}
              value={value.name}
              onChange={(event) => patch({ name: event.target.value })}
              className={inputClass}
              placeholder="請輸入"
            />
          </label>
          <label className="block text-body-s text-text-secondary">
            <span className="mb-1.5 block">計畫說明</span>
            <textarea
              disabled={disabled}
              value={value.description}
              onChange={(event) => patch({ description: event.target.value })}
              className={`${inputClass} min-h-24 resize-y`}
              placeholder="請輸入"
            />
          </label>
        </>
      ) : null}
      <label className="block text-body-s text-text-secondary">
        <span className="mb-1.5 block">
          <b className="text-status-error-emphasis">*</b>計畫等級
        </span>
        <SiteSelect
          disabled={disabled}
          value={value.level}
          onChange={(event) =>
            patch({ level: Number(event.target.value) as 1 | 2 | 3 })
          }
          className={inputClass}
        >
          <option value={1}>Level 1</option>
          <option value={2}>Level 2</option>
          <option value={3}>Level 3</option>
        </SiteSelect>
      </label>
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-1.5 text-body-s text-text-secondary">
          <b className="text-status-error-emphasis">*</b>速限
        </legend>
        <div className="flex flex-wrap gap-5 text-body-s text-text-primary">
          <label className="flex cursor-pointer items-center gap-2">
            <Radio name="speed-mode" checked={value.speedMode === "stopped"} onChange={() => patch({ speedMode: "stopped" })} />
            停駛
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <Radio name="speed-mode" checked={value.speedMode === "custom"} onChange={() => patch({ speedMode: "custom" })} />
            自定義
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {[10, 20, 30, 40].map((speed) => (
            <Button hierarchy="subordinate" variant="outlined" className="min-w-16" key={speed} onPress={() =>
                patch({ speedMode: "custom", customSpeed: String(speed) })
              }>{speed}</Button>
          ))}
        </div>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="any"
            disabled={disabled || value.speedMode === "stopped"}
            value={value.speedMode === "stopped" ? "0" : value.customSpeed}
            onChange={(event) => patch({ customSpeed: event.target.value })}
            className={`${inputClass} pr-20`}
            aria-label="速限數值"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-body-s text-text-tertiary">
            km/h
          </span>
        </div>
        {value.speedMode === "custom" &&
        (!Number.isFinite(Number(value.customSpeed)) ||
          Number(value.customSpeed) <= 0) ? (
          <p className="text-body-xs text-status-error-emphasis">
            自定義速限必須是大於 0 的數值。
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
