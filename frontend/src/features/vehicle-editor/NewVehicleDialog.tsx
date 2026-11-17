import { NumberInput } from '../../components/NumberInput'
import { useState } from 'react';
import { Bus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../components/ui';

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
    <Dialog
      title={<span className="inline-flex items-center gap-2"><Bus className="text-status-warning" size={20} aria-hidden />{t('vehicleEditor.newVehicle.title')}</span>}
      onClose={onCancel}
      widthClassName="w-[480px]"
      footer={(
        <>
          <Button hierarchy="subordinate" variant="tonal" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button onPress={() => onConfirm(name || t('vehicleEditor.newVehicle.unnamed'), width, height)} disabled={!name.trim() || width < 40 || height < 40}>{t('vehicleEditor.newVehicle.create')}</Button>
        </>
      )}
    >
        <div className="mb-4">
          <label className="mb-1.5 block text-body-xs-bold text-text-tertiary">{t('vehicleEditor.newVehicle.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border-tertiary bg-surface-secondary px-3 py-2 text-body-s text-text-primary transition-colors focus:border-status-warning focus:outline-none focus:ring-1 focus:ring-status-warning-light"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-body-xs-bold text-text-tertiary">{t('vehicleEditor.newVehicle.presets')}</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_KEYS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setWidth(p.width);
                  setHeight(p.height);
                }}
                className={`rounded-lg border px-3 py-2 text-left text-body-xs transition-all ${
                  width === p.width && height === p.height
                    ? 'border-status-warning bg-status-warning-light text-status-warning'
                    : 'border-border-tertiary bg-surface-secondary text-text-tertiary hover:border-border-primary hover:text-text-primary'
                }`}
              >
                {t(`vehicleEditor.newVehicle.${p.key}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-body-xs-bold text-text-tertiary">{t('vehicleEditor.newVehicle.customSize')}</label>
          <div className="flex items-center gap-2">
            <NumberInput
              min={40}
              max={512}
              value={width}
              onChange={(n) => setWidth(n)}
              className="flex-1 rounded-lg border border-border-tertiary bg-surface-secondary px-3 py-2 text-body-s text-text-primary focus:border-status-warning focus:outline-none"
            />
            <span className="text-body-s text-text-quaternary">×</span>
            <NumberInput
              min={40}
              max={512}
              value={height}
              onChange={(n) => setHeight(n)}
              className="flex-1 rounded-lg border border-border-tertiary bg-surface-secondary px-3 py-2 text-body-s text-text-primary focus:border-status-warning focus:outline-none"
            />
          </div>
        </div>
</Dialog>
  );
}
