import { ImageIcon } from 'lucide-react';
import {
  resolveVehicleAssetUrl,
  vehicleAssetsForCategory,
  type VehicleAssetCategory,
  type VehiclePresetAsset,
} from '../constants/assetLibrary';

function AssetThumb({
  asset,
  selected,
  onSelect,
}: {
  asset: VehiclePresetAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = resolveVehicleAssetUrl(asset.file);

  return (
    <button
      type="button"
      onClick={onSelect}
      title={asset.label}
      className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-all ${
        selected
          ? 'border-status-warning bg-status-warning-light'
          : 'border-border-quaternary bg-zinc-800/50 hover:border-border-primary'
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-surface-sub-background">
        {url ? (
          <img src={url} alt="" className="max-h-9 max-w-9 object-contain" draggable={false} />
        ) : (
          <ImageIcon size={16} className="text-text-disabled" />
        )}
      </div>
      <span className="max-w-[56px] truncate text-[8px] text-text-tertiary">{asset.label}</span>
    </button>
  );
}

export function VehicleAssetPicker({
  category,
  value,
  onSelect,
  compact,
}: {
  category: VehicleAssetCategory;
  value: string;
  onSelect: (file: string, asset?: VehiclePresetAsset) => void;
  compact?: boolean;
}) {
  const assets = vehicleAssetsForCategory(category);
  if (assets.length === 0) return null;

  return (
    <div className={`rounded-lg border border-border-quaternary bg-surface-primary ${compact ? 'p-2' : 'p-2.5'}`}>
      <div className="mb-2 flex items-center gap-1 text-caption-2 text-text-quaternary">
        <ImageIcon size={11} />
        <span>圖庫（public/vehicle-editor/{category}/）</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {assets.map((asset) => (
          <AssetThumb
            key={asset.id}
            asset={asset}
            selected={value === asset.file || value.trim() === asset.file}
            onSelect={() => onSelect(asset.file, asset)}
          />
        ))}
      </div>
      {category !== 'light' && (
        <input
          value={value}
          onChange={(e) => onSelect(e.target.value)}
          className="mt-2 w-full rounded border border-border-quaternary bg-surface-secondary px-2 py-1 font-mono text-caption-2 text-text-secondary"
          placeholder="或輸入檔名路徑"
        />
      )}
    </div>
  );
}
