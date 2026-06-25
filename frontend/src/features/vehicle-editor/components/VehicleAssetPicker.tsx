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
          ? 'border-amber-500 bg-amber-500/10'
          : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-zinc-950">
        {url ? (
          <img src={url} alt="" className="max-h-9 max-w-9 object-contain" draggable={false} />
        ) : (
          <ImageIcon size={16} className="text-zinc-600" />
        )}
      </div>
      <span className="max-w-[56px] truncate text-[8px] text-zinc-400">{asset.label}</span>
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
    <div className={`rounded-lg border border-zinc-700/60 bg-zinc-900/50 ${compact ? 'p-2' : 'p-2.5'}`}>
      <div className="mb-2 flex items-center gap-1 text-[9px] text-zinc-500">
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
          className="mt-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-300"
          placeholder="或輸入檔名路徑"
        />
      )}
    </div>
  );
}
