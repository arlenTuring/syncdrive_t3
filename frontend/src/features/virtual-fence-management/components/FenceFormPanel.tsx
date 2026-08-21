import { X } from 'lucide-react';
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
              {opt.label}
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
          {mode === 'create' ? '建立圍籬' : '編輯圍籬'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="關閉"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <RequiredLabel>圍籬名稱</RequiredLabel>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="請輸入"
            className="h-9 w-full rounded-lg border border-zinc-700/60 bg-[#27272a] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF]/60"
          />
        </div>

        <div>
          <RequiredLabel>涵蓋範圍</RequiredLabel>
          <div className="min-h-9 rounded-lg border border-zinc-700/60 bg-[#27272a] px-2 py-1.5">
            {draft.coverage.length === 0 ? (
              <p className="px-1 py-1 text-sm text-zinc-500">
                {draft.vertices.length >= 3
                  ? '圍籬已繪製，尚未覆蓋到路段'
                  : '於地圖拉框或放置多邊形後自動帶入'}
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
                      aria-label={`移除 ${seg.label}`}
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
          <RequiredLabel>啟用圍籬</RequiredLabel>
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
          <RequiredLabel>作動行為</RequiredLabel>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            進入與離開可同時設定，各自可複選行為。
          </p>
          <BehaviorGroup
            title="進入"
            selected={draft.enterBehaviors}
            onToggle={(kind) =>
              onChange({
                ...draft,
                enterBehaviors: toggleBehavior(draft.enterBehaviors, kind),
              })
            }
          />
          <BehaviorGroup
            title="離開"
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
            <RequiredLabel>載具速度限制</RequiredLabel>
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
              <span className="text-sm text-zinc-400">km/hr</span>
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
          {mode === 'create' ? '放棄' : '取消'}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-[#2B7FFF] px-5 text-sm font-medium text-white transition hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {mode === 'create' ? '建立' : '儲存'}
        </button>
      </div>
    </aside>
  );
}
