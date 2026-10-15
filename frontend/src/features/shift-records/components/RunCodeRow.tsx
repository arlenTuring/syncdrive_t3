import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** 複製到剪貼簿；Clipboard API 不能用（非安全來源等）時退回選取複製 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 改用下面的退路
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 班次唯一碼（訂單號＠建立時刻）：顯示完整值（太長時視覺截斷，滑過可看全文），
 * 複製的一定是完整值；貼到「運行管理紀錄」可找到同一次執行。
 */
export function RunCodeRow({ code }: { code: string }) {
  const [toast, setToast] = useState<{ ok: boolean; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const onCopy = async () => {
    const ok = await copyText(code);
    setToast({ ok, id: Date.now() });
  };
  return (
    <div className="inline-flex min-w-0 items-center gap-2 text-[12px] text-zinc-400">
      <span className="shrink-0">班次唯一碼：</span>
      <span className="max-w-[300px] truncate font-mono text-zinc-200 select-all" title={code}>
        {code}
      </span>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={`複製班次唯一碼 ${code}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        <Copy className="size-3.5" aria-hidden />
        複製
      </button>
      <div aria-live="polite" role="status" className="sr-only">
        {toast ? (toast.ok ? '班次唯一碼已複製' : '複製失敗，請手動選取班次唯一碼') : ''}
      </div>
      {toast ? (
        <div
          key={toast.id}
          className={`fixed bottom-8 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl ${
            toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.ok ? '班次唯一碼已複製' : '複製失敗，請手動選取班次唯一碼'}
        </div>
      ) : null}
    </div>
  );
}
