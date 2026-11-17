import { Gauge, X } from "lucide-react";
import { useEffect, useState } from "react";
import { saveDegradedDraft, type ExecutionResponse } from "./api";
import { DegradedIcon } from "./DegradedIcons";
import {
  DegradedPlanForm,
  draftFromPlan,
  planDraftPayload,
} from "./DegradedPlanForm";
import { Button, Checkbox, Dialog, IconButton } from '../../components/ui';

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
    <Dialog headerless padded={false} title={title} onClose={onClose} widthClassName="w-full max-w-[650px]" heightClassName="max-h-[calc(100vh-2rem)]">
        <header className="flex items-center px-6 py-5">
          <h2 className="text-headline-4">{title}</h2>
          <IconButton hierarchy="subordinate" variant="standard" className="ml-auto" onPress={onClose} label="關閉" icon={<X />} />
        </header>
        {children}
      </Dialog>
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
          <section className="rounded-2xl border border-border-quaternary p-4">
            <h3 className="mb-3">營運影響預估</h3>
            <div className="grid grid-cols-2 gap-3 text-center text-text-tertiary">
              <div className="rounded-xl bg-surface-secondary p-3">
                影響班次<b className="block text-text-primary">—</b>
              </div>
              <div className="rounded-xl bg-surface-secondary p-3">
                運能損失<b className="block text-text-primary">— %</b>
              </div>
            </div>
          </section>
          {error ? <p className="text-body-s text-status-error-emphasis">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>取消</Button>
          <Button type="submit" disabled={!payload || saving}>儲存</Button>
        </footer>
      </form>
    </Frame>
  );
}

/**
 * 本次降級的內容：只改名稱與說明。等級與速限屬於降級參數，只能從「調整降級參數」改；
 * 這裡的速限只顯示目前值。草稿也只存名稱與說明——舊草稿裡的 level 不讀、不送。
 */
export function ExecutionContentDialog({
  execution,
  onClose,
  onSubmit,
}: {
  execution: ExecutionResponse;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(execution.name);
  const [description, setDescription] = useState(execution.description);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = Boolean(name.trim());
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void saveDegradedDraft("active-content", {
          execution_id: execution.execution_id,
          name,
          description,
        }).catch(() => undefined),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [description, execution.execution_id, name]);
  const input =
    "w-full rounded-xl bg-[#252b34] px-4 py-3 outline-none focus:ring-1 focus:ring-border-theme";
  return (
    <Frame title="降級計畫內容" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setSaving(true);
          void onSubmit(name.trim(), description.trim()).catch((reason) => {
            setError(reason instanceof Error ? reason.message : "儲存失敗");
            setSaving(false);
          });
        }}
      >
        <div className="space-y-4 px-6 pb-6">
          <label className="block">
            <span className="mb-1 block">
              <b className="text-status-error-emphasis">*</b>計畫名稱
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
          <div className="border-t border-border-quaternary pt-4">
            <div className="flex items-center justify-center gap-3 rounded-xl bg-surface-secondary p-5">
              <DegradedIcon name="speed" className="size-8" />
              <div className="text-left">
                <span className="block text-body-s text-text-tertiary">速限</span>
                <b className="text-3xl font-normal text-text-primary">
                  {execution.speed_limit_kmh}
                </b>
                <small className="ml-1.5 text-text-tertiary">km/h</small>
              </div>
            </div>
          </div>
          {error ? <p className="text-body-s text-status-error-emphasis">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>取消</Button>
          <Button disabled={!valid || saving} type="submit">儲存</Button>
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
          <h3 className="mb-3 border-b border-border-quaternary pb-3 text-headline-5">
            恢復預設參數
          </h3>
          <div className="rounded-xl bg-surface-secondary p-5 text-center text-text-tertiary">
            <Gauge className="mr-2 inline size-5 text-text-theme" />
            預計速限{" "}
            <b className="ml-2 text-3xl font-normal text-text-primary">
              {execution.restore_speed_limit_kmh ?? "—"}
            </b>{" "}
            km/h
          </div>
        </section>
        <fieldset className="space-y-3">
          <legend className="mb-3 w-full border-b border-border-quaternary pb-3 text-headline-5">
            安全檢核
          </legend>
          <label className="flex gap-3">
            <Checkbox checked={first} onCheckedChange={(checked) => setFirst(checked)} />
            我已確認現場工作人員與車輛已完全撤離隔離區。
          </label>
          <label className="flex gap-3">
            <Checkbox checked={second} onCheckedChange={(checked) => setSecond(checked)} />
            我已確認系統軟硬體警報已全數恢復正常。
          </label>
        </fieldset>
        {error ? <p className="text-body-s text-status-error-emphasis">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
        <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>取消</Button>
        <Button disabled={!first || !second || saving} onPress={() => {
            setSaving(true);
            void onSubmit({
              personnel_and_vehicles_cleared: first,
              alarms_cleared: second,
            }).catch((reason) => {
              setError(reason instanceof Error ? reason.message : "解除失敗");
              setSaving(false);
            });
          }}>解除降級</Button>
      </footer>
    </Frame>
  );
}
