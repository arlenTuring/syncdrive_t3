import { useMemo, useState } from 'react';
import { FolderOpen, ImageIcon } from 'lucide-react';
import {
  DASHBOARD_ICON_LIBRARY,
  PRESET_DASHBOARD_ICONS,
  iconUrlFromSet,
  presetIconUrl,
  presetIconsForCategory,
  resolvePresetIconPath,
  type IconLibrarySet,
} from '../constants/iconLibrary';

export type IconPickerScope = 'presets' | 'vehicle-operations' | 'all';

export function DashboardIconPicker({
  value,
  setId,
  scope = 'all',
  onSelect,
  compact,
}: {
  value?: string;
  setId?: string;
  scope?: IconPickerScope;
  onSelect: (file: string, url: string, set: IconLibrarySet) => void;
  compact?: boolean;
}) {
  const sets = useMemo(() => {
    if (scope === 'all') return DASHBOARD_ICON_LIBRARY;
    return DASHBOARD_ICON_LIBRARY.filter((s) => s.id === scope);
  }, [scope]);

  const initialSetId = setId ?? sets[0]?.id ?? 'presets';
  const [activeSetId, setActiveSetId] = useState(initialSetId);
  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0];

  const selectedPath = resolvePresetIconPath(value);
  const initialCategory =
    PRESET_DASHBOARD_ICONS.find((i) => i.path === selectedPath)?.categoryId
    ?? 'navigation';
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategory);

  if (!activeSet) return null;

  const isPresetSet = activeSet.id === 'presets' && activeSet.categories?.length;

  return (
    <div className={`rounded-lg border border-zinc-700/60 bg-zinc-900/50 ${compact ? 'p-2' : 'p-2.5'}`}>
      {sets.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {sets.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => setActiveSetId(set.id)}
              className={`px-2 py-0.5 rounded text-[9px] font-semibold transition-colors ${
                activeSetId === set.id
                  ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                  : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {set.label}
            </button>
          ))}
        </div>
      )}

      {isPresetSet ? (
        <>
          <div className="flex items-center gap-1 mb-2 text-[9px] text-zinc-500">
            <FolderOpen size={11} />
            <span>選擇分類</span>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {activeSet.categories!.map((cat) => {
              const count = presetIconsForCategory(cat.id).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategoryId(cat.id)}
                  className={`px-2 py-0.5 rounded text-[9px] font-semibold transition-colors ${
                    activeCategoryId === cat.id
                      ? 'bg-violet-600/25 text-violet-300 border border-violet-500/40'
                      : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
          {activeSet.categories!.find((c) => c.id === activeCategoryId)?.description && (
            <p className="text-[9px] text-zinc-500 mb-2 leading-relaxed">
              {activeSet.categories!.find((c) => c.id === activeCategoryId)?.description}
            </p>
          )}
          <PresetIconGrid
            icons={presetIconsForCategory(activeCategoryId)}
            selectedPath={selectedPath}
            onSelect={(path, url) => onSelect(path, url, activeSet)}
          />
        </>
      ) : (
        <>
          {activeSet.description && (
            <p className="text-[9px] text-zinc-500 mb-2 leading-relaxed">{activeSet.description}</p>
          )}
          {activeSet.icons.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-[10px] text-zinc-500 justify-center">
              <ImageIcon size={14} />
              尚無圖示
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto">
              {activeSet.icons.map((icon) => {
                const url = iconUrlFromSet(activeSet, icon.file);
                const selected = value === icon.file || value === url || value?.endsWith(`/${icon.file}`);
                return (
                  <IconThumb
                    key={`${activeSet.id}-${icon.file}`}
                    url={url}
                    label={icon.label}
                    selected={!!selected}
                    onClick={() => onSelect(icon.file, url, activeSet)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PresetIconGrid({
  icons,
  selectedPath,
  onSelect,
}: {
  icons: { path: string; label: string }[];
  selectedPath: string;
  onSelect: (path: string, url: string) => void;
}) {
  if (icons.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-[10px] text-zinc-500 justify-center">
        <ImageIcon size={14} />
        此分類尚無圖示
      </div>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
      {icons.map((icon) => {
        const url = presetIconUrl(icon.path);
        return (
          <IconThumb
            key={icon.path}
            url={url}
            label={icon.label}
            selected={selectedPath === icon.path}
            onClick={() => onSelect(icon.path, url)}
          />
        );
      })}
    </div>
  );
}

function IconThumb({
  url,
  label,
  selected,
  onClick,
}: {
  url: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 p-1.5 rounded border transition-all ${
        selected
          ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30'
          : 'border-zinc-700/80 bg-zinc-800/40 hover:border-zinc-500'
      }`}
    >
      <img
        src={url}
        alt=""
        className="w-8 h-8 object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = '0.25';
        }}
      />
      <span className="text-[8px] text-zinc-400 truncate w-full text-center leading-tight">
        {label}
      </span>
    </button>
  );
}
