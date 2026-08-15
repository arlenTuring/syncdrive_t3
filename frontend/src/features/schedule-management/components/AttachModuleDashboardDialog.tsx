import { LayoutDashboard, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { listStoredDashboardPlanes } from '../utils/moduleDashboardPages';

type AttachModuleDashboardDialogProps = {
  moduleLabel: string;
  onCancel: () => void;
  onConfirm: (args: { planeId: string; label: string }) => void;
};

export function AttachModuleDashboardDialog({
  moduleLabel,
  onCancel,
  onConfirm,
}: AttachModuleDashboardDialogProps) {
  const planes = useMemo(() => listStoredDashboardPlanes(), []);
  const [planeId, setPlaneId] = useState(planes[0]?.id ?? '');
  const [label, setLabel] = useState(planes[0]?.name ?? '');

  const selected = planes.find((plane) => plane.id === planeId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#141416] shadow-2xl"
        role="dialog"
        aria-labelledby="attach-dashboard-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 id="attach-dashboard-title" className="text-sm font-semibold text-zinc-100">
              新增子頁面
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">{moduleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {planes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-8 text-center">
              <LayoutDashboard className="mx-auto size-8 text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-300">還沒有可掛載的儀表板</p>
              <p className="mt-1 text-xs text-zinc-500">
                請先到「儀表板管理」建立或匯入平面
              </p>
            </div>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-400">載入儀表板平面</span>
                <select
                  value={planeId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setPlaneId(nextId);
                    const plane = planes.find((item) => item.id === nextId);
                    if (plane) setLabel(plane.name);
                  }}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-sky-500"
                >
                  {planes.map((plane) => (
                    <option key={plane.id} value={plane.id}>
                      {plane.name}（{plane.width}×{plane.height}）
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-400">子頁面名稱</span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="例如：班表部署總覽"
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
                />
              </label>

              {selected ? (
                <p className="text-[11px] text-zinc-500">
                  將以檢視模式載入「{selected.name}」；內容來自儀表板編輯器已儲存的平面。
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!planeId || !label.trim()}
            onClick={() => {
              if (!planeId || !label.trim()) return;
              onConfirm({ planeId, label: label.trim() });
            }}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            新增
          </button>
        </div>
      </div>
    </div>
  );
}
