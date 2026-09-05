import { NumberInput } from '../../components/NumberInput'
import { useState } from 'react';
import { Monitor, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [name, setName] = useState(() => t('dashboard.newPlane.nameDefault'));
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
            <h2 className="text-zinc-100 font-semibold text-base">{t('dashboard.newPlane.title')}</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">{t('dashboard.newPlane.name')}</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                       focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
          />
        </div>

        {/* Presets */}
        <div className="mb-4">
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">{t('dashboard.newPlane.presets')}</label>
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
          <label className="block text-zinc-400 text-xs mb-1.5 font-medium">{t('dashboard.newPlane.customResolution')}</label>
          <div className="flex items-center gap-2">
            <NumberInput min={320} max={7680}
              value={width}
              onChange={n => setWidth(n)}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                         focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
            />
            <span className="text-zinc-500 text-sm">×</span>
            <NumberInput min={240} max={4320}
              value={height}
              onChange={n => setHeight(n)}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm
                         focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
            />
          </div>
          <p className="text-zinc-500 text-xs mt-1.5">{t('dashboard.newPlane.aspectRatio')}<span className="text-cyan-400 font-mono">{ratio}</span></p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-zinc-600 text-zinc-400 text-sm
                       hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onConfirm(name || t('dashboard.unnamedPlane'), width, height)}
            disabled={!name.trim() || width < 320 || height < 240}
            className="flex-1 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium
                       hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('dashboard.newPlane.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
