import { X } from 'lucide-react';
import { useEffect } from 'react';

type NavigateToSetupModalProps = {
  onClose: () => void;
  onConfirm: () => void;
};

export function NavigateToSetupModal({ onClose, onConfirm }: NavigateToSetupModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="navigate-setup-title"
        className="w-full max-w-[520px] rounded-2xl bg-[#222225] px-8 py-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="navigate-setup-title"
            className="text-lg font-semibold leading-7 text-[#F3F4F6]"
          >
            引導您至獨立頁面設定
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-400">
          接下來將引導您完成設定，系統已為您開啟獨立頁面，確保您的資料安全並不會丟失。
        </p>

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-[38px] items-center justify-center rounded-lg bg-[#2B7FFF] px-5 text-sm font-medium text-white transition hover:bg-[#2569e6]"
          >
            前往設定
          </button>
        </div>
      </div>
    </div>
  );
}
