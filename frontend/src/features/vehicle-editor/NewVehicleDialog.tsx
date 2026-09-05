import { NumberInput } from '../../components/NumberInput'
import { useState } from 'react';
import { Bus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PRESET_KEYS = [
  { key: 'presetLandscape' as const, width: 500, height: 100 },
  { key: 'presetDesign' as const, width: 100, height: 150 },
  { key: 'presetSmall' as const, width: 80, height: 120 },
  { key: 'presetMedium' as const, width: 120, height: 180 },
  { key: 'presetLarge' as const, width: 160, height: 240 },
];

export function NewVehicleDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string, width: number, height: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => t('vehicleEditor.newVehicle.nameDefault'));
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(150);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bus className="text-amber-400" size={20} />
            <h2 className="text-base font-semibold text-zinc-100">{t('vehicleEditor.newVehicle.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">{t('vehicleEditor.newVehicle.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">{t('vehicleEditor.newVehicle.presets')}</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_KEYS.map((p) => (
              <button
                key={p.key}
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
                {t(`vehicleEditor.newVehicle.${p.key}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">{t('vehicleEditor.newVehicle.customSize')}</label>
          <div className="flex items-center gap-2">
            <NumberInput
              min={40}
              max={512}
              value={width}
              onChange={(n) => setWidth(n)}
              className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
            <span className="text-sm text-zinc-500">×</span>
            <NumberInput
              min={40}
              max={512}
              value={height}
              onChange={(n) => setHeight(n)}
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
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(name || t('vehicleEditor.newVehicle.unnamed'), width, height)}
            disabled={!name.trim() || width < 40 || height < 40}
            className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('vehicleEditor.newVehicle.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
