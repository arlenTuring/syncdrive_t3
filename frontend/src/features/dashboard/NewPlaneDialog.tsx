import { useState } from 'react';
import { Monitor, X } from 'lucide-react';

const PRESETS = [
  { label: '32:9 — 3840×1080', width: 3840, height: 1080 },
  { label: '16:9 — 1920×1080', width: 1920, height: 1080 },
  { label: '21:9 — 2560×1080', width: 2560, height: 1080 },
  { label: '4:3 — 1600×1200',  width: 1600, height: 1200 },
];

interface Props {
  onConfirm: (name: string, width: number, height: number) => void;
  onCancel: () => void;
}

export function NewPlaneDialog({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState('新平面');
  const [width, setWidth] = useState(3840);
  const [height, setHeight] = useState(1080);

  const ratio = (() => {
    const g = gcd(width, height);
    return `${width / g}:${height / g}`;
  })();

  function handlePreset(w: number, h: number) {
    setWidth(w);
    setHeight(h);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Monitor className="text-cyan-400" size={20} />
            <h2 className="text-zinc-100 font-semibold text-base">新增平面</h2>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">平面名稱</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                       focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
          />
        </div>

        {/* Presets */}
        <div className="mb-4">
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">解析度預設</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p.width, p.height)}
                className={`px-3 py-2 text-xs rounded-lg border transition-all text-left ${
                  width === p.width && height === p.height
                    ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300'
                    : 'bg-zinc-800 border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom resolution */}
        <div className="mb-4">
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">自訂解析度</label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={320} max={7680}
              value={width}
              onChange={e => setWidth(Number(e.target.value))}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                         focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
            />
            <span className="text-zinc-500 text-sm">×</span>
            <input
              type="number" min={240} max={4320}
              value={height}
              onChange={e => setHeight(Number(e.target.value))}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                         focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
            />
          </div>
          <p className="text-zinc-500 text-xs mt-1.5">長寬比：<span className="text-cyan-400 font-mono">{ratio}</span></p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-zinc-600 text-zinc-400 text-sm
                       hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(name || '未命名平面', width, height)}
            disabled={!name.trim() || width < 320 || height < 240}
            className="flex-1 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium
                       hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            建立平面
          </button>
        </div>
      </div>
    </div>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
