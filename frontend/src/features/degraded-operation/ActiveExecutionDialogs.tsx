import { Gauge, X } from "lucide-react";
import { useEffect, useState } from "react";
import { saveDegradedDraft, type ExecutionResponse } from "./api";
import {
  DegradedPlanForm,
  draftFromPlan,
  planDraftPayload,
} from "./DegradedPlanForm";

function Frame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="max-h-[calc(100vh-2rem)] w-full max-w-[650px] overflow-y-auto rounded-3xl border border-zinc-700 bg-[#17181c] shadow-2xl"
      >
        <header className="flex items-center px-6 py-5">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-zinc-400 hover:text-white"
            aria-label="關閉"
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function AdjustExecutionDialog({
  execution,
  onClose,
  onSubmit,
}: {
  execution: ExecutionResponse;
  onClose: () => void;
  onSubmit: (level: number, speed: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    draftFromPlan({
      id: "",
      name: execution.name,
      description: execution.description,
      level: execution.level,
      speed_limit_kmh: execution.speed_limit_kmh,
      version: 1,
      created_at: "",
      updated_at: "",
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = planDraftPayload(draft);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void saveDegradedDraft("active-parameters", {
          execution_id: execution.execution_id,
          draft,
        }).catch(() => undefined),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [draft, execution.execution_id]);
  return (
    <Frame title="調整參數" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!payload) return;
          setSaving(true);
          void onSubmit(payload.level, payload.speed_limit_kmh).catch(
            (reason) => {
              setError(reason instanceof Error ? reason.message : "儲存失敗");
              setSaving(false);
            },
          );
        }}
      >
        <div className="space-y-5 px-6 pb-6">
          <DegradedPlanForm
            value={draft}
            onChange={setDraft}
            disabled={saving}
            showIdentity={false}
          />
          <section className="rounded-2xl border border-zinc-700 p-4">
            <h3 className="mb-3">營運影響預估</h3>
            <div className="grid grid-cols-2 gap-3 text-center text-zinc-400">
              <div className="rounded-xl bg-[#29303a] p-3">
                影響班次<b className="block text-white">—</b>
              </div>
              <div className="rounded-xl bg-[#29303a] p-3">
                運能損失<b className="block text-white">— %</b>
              </div>
            </div>
          </section>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-zinc-700 px-6 py-4">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            disabled={!payload || saving}
            className="rounded-xl bg-blue-600 px-5 py-2.5 disabled:bg-zinc-700"
          >
            儲存
          </button>
        </footer>
      </form>
    </Frame>
  );
}

export function ExecutionContentDialog({
  execution,
  onClose,
  onSubmit,
}: {
  execution: ExecutionResponse;
  onClose: () => void;
  onSubmit: (name: string, description: string, level: number) => Promise<void>;
}) {
  const [name, setName] = useState(execution.name);
  const [description, setDescription] = useState(execution.description);
  const [level, setLevel] = useState(execution.level);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = Boolean(name.trim()) && [1, 2, 3].includes(level);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void saveDegradedDraft("active-content", {
          execution_id: execution.execution_id,
          name,
          description,
          level,
        }).catch(() => undefined),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [description, execution.execution_id, level, name]);
  const input =
    "w-full rounded-xl bg-[#252b34] px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500";
  return (
    <Frame title="降級計畫內容" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setSaving(true);
          void onSubmit(name.trim(), description.trim(), level).catch(
            (reason) => {
              setError(reason instanceof Error ? reason.message : "儲存失敗");
              setSaving(false);
            },
          );
        }}
      >
        <div className="space-y-4 px-6 pb-6">
          <label className="block">
            <span className="mb-1 block">
              <b className="text-red-400">*</b>計畫名稱
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block">計畫說明</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`${input} min-h-28`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block">
              <b className="text-red-400">*</b>計畫等級
            </span>
            <select
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              className={input}
            >
              <option value={1}>Level 1</option>
              <option value={2}>Level 2</option>
              <option value={3}>Level 3</option>
            </select>
          </label>
          <div className="rounded-xl bg-[#222831] p-5 text-center text-zinc-400">
            速限{" "}
            <b className="ml-3 text-2xl font-normal text-white">
              {execution.speed_limit_kmh}
            </b>{" "}
            km/h
          </div>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-zinc-700 px-6 py-4">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            disabled={!valid || saving}
            className="rounded-xl bg-blue-600 px-5 py-2.5 disabled:bg-zinc-700"
          >
            儲存
          </button>
        </footer>
      </form>
    </Frame>
  );
}

export function RestoreExecutionDialog({
  execution,
  onClose,
  onSubmit,
}: {
  execution: ExecutionResponse;
  onClose: () => void;
  onSubmit: (checks: {
    personnel_and_vehicles_cleared: boolean;
    alarms_cleared: boolean;
  }) => Promise<void>;
}) {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Frame title="終止降級並恢復營運" onClose={onClose}>
      <div className="space-y-5 px-6 pb-6">
        <section>
          <h3 className="mb-3 border-b border-zinc-700 pb-3 text-lg">
            恢復預設參數
          </h3>
          <div className="rounded-xl bg-[#222831] p-5 text-center text-zinc-400">
            <Gauge className="mr-2 inline size-5 text-blue-400" />
            預計速限{" "}
            <b className="ml-2 text-3xl font-normal text-white">
              {execution.restore_speed_limit_kmh ?? "—"}
            </b>{" "}
            km/h
          </div>
        </section>
        <fieldset className="space-y-3">
          <legend className="mb-3 w-full border-b border-zinc-700 pb-3 text-lg">
            安全檢核
          </legend>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={first}
              onChange={(event) => setFirst(event.target.checked)}
              className="mt-1 size-5"
            />
            我已確認現場工作人員與車輛已完全撤離隔離區。
          </label>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={second}
              onChange={(event) => setSecond(event.target.checked)}
              className="mt-1 size-5"
            />
            我已確認系統軟硬體警報已全數恢復正常。
          </label>
        </fieldset>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-3 border-t border-zinc-700 px-6 py-4">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          disabled={!first || !second || saving}
          onClick={() => {
            setSaving(true);
            void onSubmit({
              personnel_and_vehicles_cleared: first,
              alarms_cleared: second,
            }).catch((reason) => {
              setError(reason instanceof Error ? reason.message : "解除失敗");
              setSaving(false);
            });
          }}
          className="rounded-xl bg-blue-600 px-5 py-2.5 disabled:bg-zinc-700"
        >
          解除降級
        </button>
      </footer>
    </Frame>
  );
}
