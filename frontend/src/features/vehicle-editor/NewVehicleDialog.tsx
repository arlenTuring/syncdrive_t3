import { useState } from 'react';
import { Bus, X } from 'lucide-react';

const PRESETS = [
  { label: '圖台橫向 — 500×100', width: 500, height: 100 },
  { label: '設計稿 — 100×150', width: 100, height: 150 },
  { label: '小型 — 80×120', width: 80, height: 120 },
  { label: '中型 — 120×180', width: 120, height: 180 },
  { label: '大型 — 160×240', width: 160, height: 240 },
];

export function NewVehicleDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string, width: number, height: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('新載具');
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(150);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bus className="text-amber-400" size={20} />
            <h2 className="text-base font-semibold text-zinc-100">新增載具</h2>
          </div>
          <button type="button" onClick={onCancel} className="text-zinc-500 transition-colors hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">載具名稱</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">畫布尺寸預設</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setWidth(p.width);
                  setHeight(p.height);
                }}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                  width === p.width && height === p.height
                    ? 'border-amber-500 bg-amber-600/20 text-amber-300'
                    : 'border-zinc-600 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">自訂像素尺寸</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={40}
              max={512}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
            <span className="text-sm text-zinc-500">×</span>
            <input
              type="number"
              min={40}
              max={512}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-zinc-600 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(name || '未命名載具', width, height)}
            disabled={!name.trim() || width < 40 || height < 40}
            className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            建立載具
          </button>
        </div>
      </div>
    </div>
  );
}
