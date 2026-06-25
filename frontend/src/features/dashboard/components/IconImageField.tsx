import { useState } from 'react';
import { ImageIcon, Link2, Upload } from 'lucide-react';
import { DashboardIconPicker } from './DashboardIconPicker';
import { isPresetDashboardIcon } from '../constants/iconLibrary';

type Tab = 'preset' | 'custom';

export function IconImageField({
  value,
  onChange,
  placeholder = '/dashboard-icons/navigation/nav.png',
  scope = 'presets',
}: {
  value?: string;
  onChange: (url: string) => void;
  placeholder?: string;
  scope?: 'presets' | 'vehicle-operations' | 'all';
}) {
  const [tab, setTab] = useState<Tab>(() => {
    if (!value?.trim()) return 'preset';
    return isPresetDashboardIcon(value) ? 'preset' : 'custom';
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setTab('preset')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] font-semibold border transition-colors ${
            tab === 'preset'
              ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
          }`}
        >
          <ImageIcon size={11} />
          預設圖示
        </button>
        <button
          type="button"
          onClick={() => setTab('custom')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] font-semibold border transition-colors ${
            tab === 'custom'
              ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
          }`}
        >
          <Link2 size={11} />
          自訂 URL
        </button>
      </div>

      {tab === 'preset' ? (
        <DashboardIconPicker
          compact
          scope={scope}
          setId={scope === 'vehicle-operations' ? 'vehicle-operations' : 'presets'}
          value={value}
          onSelect={(_file, url) => onChange(url)}
        />
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2.5">
          <p className="text-[9px] text-zinc-500 leading-relaxed flex items-start gap-1">
            <Upload size={11} className="shrink-0 mt-0.5" />
            貼上已上傳至 public 或 CDN 的圖片網址；留空則不使用圖片圖示。
          </p>
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono"
            placeholder={placeholder}
          />
          {value?.trim() ? (
            <div className="flex items-center gap-2 pt-1">
              <img
                src={value}
                alt=""
                className="w-10 h-10 object-contain rounded border border-zinc-700 bg-zinc-800/80 p-1"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '0.3';
                }}
              />
              <span className="text-[9px] text-zinc-500 break-all">{value}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
