import { useState } from 'react';
import { ImageIcon, Link2, Upload } from 'lucide-react';
import { DashboardIconPicker } from './DashboardIconPicker';
import { isPresetDashboardIcon } from '../constants/iconLibrary';
import { SegmentedControl } from '../../../components/ui';

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
      <SegmentedControl
        label="圖示來源"
        className="flex w-full [&>button]:flex-1"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'preset', label: <span className="inline-flex items-center gap-1"><ImageIcon size={12} aria-hidden />預設圖示</span> },
          { id: 'custom', label: <span className="inline-flex items-center gap-1"><Link2 size={12} aria-hidden />自訂 URL</span> },
        ]}
      />

      {tab === 'preset' ? (
        <DashboardIconPicker
          compact
          scope={scope}
          setId={scope === 'vehicle-operations' ? 'vehicle-operations' : 'presets'}
          value={value}
          onSelect={(_file, url) => onChange(url)}
        />
      ) : (
        <div className="space-y-2 rounded-lg border border-border-quaternary bg-surface-primary p-2.5">
          <p className="text-caption-2 text-text-quaternary flex items-start gap-1">
            <Upload size={11} className="shrink-0 mt-0.5" />
            貼上已上傳至 public 或 CDN 的圖片網址；留空則不使用圖片圖示。
          </p>
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-surface-secondary border border-border-quaternary text-text-primary text-body-xs font-mono"
            placeholder={placeholder}
          />
          {value?.trim() ? (
            <div className="flex items-center gap-2 pt-1">
              <img
                src={value}
                alt=""
                className="w-10 h-10 object-contain rounded border border-border-quaternary bg-surface-secondary p-1"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '0.3';
                }}
              />
              <span className="text-caption-2 text-text-quaternary break-all">{value}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
