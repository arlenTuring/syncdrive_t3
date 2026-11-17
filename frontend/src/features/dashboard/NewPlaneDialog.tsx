import { NumberInput } from '../../components/NumberInput'
import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../components/ui';

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
    <Dialog padded={false} title={<span className="inline-flex items-center gap-2"><Monitor className="text-text-theme" size={20} aria-hidden />{t('dashboard.newPlane.title')}</span>} onClose={onCancel} widthClassName="w-[480px]">
<div className="px-6 pb-6 flex min-h-0 flex-1 flex-col overflow-auto">
        {/* Name */}
        <div className="mb-4">
          <label className="block text-text-tertiary text-body-xs-bold mb-1.5">{t('dashboard.newPlane.name')}</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-surface-secondary border border-border-tertiary rounded-lg px-3 py-2 text-text-primary text-body-s
                       focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors"
          />
        </div>

        {/* Presets */}
        <div className="mb-4">
          <label className="block text-text-tertiary text-body-xs-bold mb-1.5">{t('dashboard.newPlane.presets')}</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p.width, p.height)}
                className={`px-3 py-2 text-body-xs rounded-lg border transition-all text-left ${
                  width === p.width && height === p.height
                    ? 'bg-surface-theme border-border-theme text-text-theme'
                    : 'bg-surface-secondary border-border-tertiary text-text-tertiary hover:border-border-primary hover:text-text-primary'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom resolution */}
        <div className="mb-4">
          <label className="block text-text-tertiary text-body-xs-bold mb-1.5">{t('dashboard.newPlane.customResolution')}</label>
          <div className="flex items-center gap-2">
            <NumberInput min={320} max={7680}
              value={width}
              onChange={n => setWidth(n)}
              className="flex-1 bg-surface-secondary border border-border-tertiary rounded-lg px-3 py-2 text-text-primary text-body-s
                         focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors"
            />
            <span className="text-text-quaternary text-body-s">×</span>
            <NumberInput min={240} max={4320}
              value={height}
              onChange={n => setHeight(n)}
              className="flex-1 bg-surface-secondary border border-border-tertiary rounded-lg px-3 py-2 text-text-primary text-body-s
                         focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors"
            />
          </div>
          <p className="text-text-quaternary text-body-xs mt-1.5">{t('dashboard.newPlane.aspectRatio')}<span className="text-text-theme font-mono">{ratio}</span></p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <Button hierarchy="subordinate" variant="outlined" className="flex-1" onPress={onCancel} type="submit">{t('common.cancel')}</Button>
          <Button className="flex-1" onPress={() => onConfirm(name || t('dashboard.unnamedPlane'), width, height)} disabled={!name.trim() || width < 320 || height < 240} type="submit">{t('dashboard.newPlane.create')}</Button>
        </div>
      </div>
</Dialog>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
