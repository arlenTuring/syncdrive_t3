import { useRef, useState } from 'react';
import {
  Bus,
  Calendar,
  Copy,
  Download,
  Maximize2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VehicleDefinitionMapView } from './elements/VehicleDefinitionMapView';
import type { VehicleDefinition } from './types';

export function VehicleList({
  vehicles,
  onSelect,
  onCreate,
  onDelete,
  onDuplicate,
  onExportOne,
  onExportAll,
  onImportFile,
  banner,
  renderUsage,
  readOnly = false,
}: {
  vehicles: VehicleDefinition[];
  /** 清單上方的狀態列（載入中、離線、刪除被擋下的原因…） */
  banner?: ReactNode;
  /** 名稱下方：這個模型是不是預設、被哪些地圖／元件使用 */
  renderUsage?: (vehicle: VehicleDefinition) => ReactNode;
  /** 後端還沒回來或離線：只看不改 */
  readOnly?: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void | Promise<void>;
  onDuplicate: (id: string) => void;
  onExportOne: (id: string) => void;
  onExportAll: () => void;
  onImportFile: (file: File) => Promise<number>;
}) {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const formatDate = (ts: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const count = await onImportFile(file);
      setImportStatus(count > 0 ? 'ok' : 'error');
    } catch {
      setImportStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      window.setTimeout(() => setImportStatus('idle'), 2000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0a0f1a] p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
              <Bus className="text-amber-400" size={28} />
              {t('vehicleEditor.list.title')}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              {t('vehicleEditor.list.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-zinc-600">
              {t('vehicleEditor.list.savedCount', { count: vehicles.length })}
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              <Upload size={14} />
              {importStatus === 'ok'
                ? t('vehicleEditor.list.importOk')
                : importStatus === 'error'
                  ? t('vehicleEditor.list.importFail')
                  : t('vehicleEditor.list.importJson')}
            </button>
            <button
              type="button"
              onClick={onExportAll}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              <Download size={14} />
              {t('vehicleEditor.list.exportAll')}
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={onCreate}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              <Plus size={14} />
              {t('vehicleEditor.list.create')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleImport(e.target.files?.[0])}
            />
          </div>
        </div>

        {banner}
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">預覽</th>
                <th className="px-4 py-3">{t('vehicleEditor.list.colName')}</th>
                <th className="hidden px-4 py-3 sm:table-cell">{t('vehicleEditor.list.colCanvas')}</th>
                <th className="hidden px-4 py-3 md:table-cell">{t('vehicleEditor.list.colElements')}</th>
                <th className="hidden px-4 py-3 lg:table-cell">{t('vehicleEditor.list.colUpdated')}</th>
                <th className="px-4 py-3 text-right">{t('vehicleEditor.list.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    {t('vehicleEditor.list.empty')}
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => (
                  <tr
                    key={v.id}
                    className="group border-b border-zinc-800/80 transition-colors last:border-b-0 hover:bg-zinc-800/40"
                  >
                    <td className="px-4 py-3">
                      {/* 縮圖用跟地圖同一個 renderer、同樣等比顯示，看到的比例就是地圖上的比例 */}
                      <div className="flex h-10 w-28 items-center justify-center overflow-hidden rounded bg-zinc-950">
                        <VehicleDefinitionMapView definition={v} displayWidth={104} displayHeight={34} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onSelect(v.id)}
                        className="flex w-full items-center gap-2 text-left font-semibold text-zinc-200 hover:text-amber-300"
                      >
                        <Bus size={14} className="shrink-0 text-zinc-600 group-hover:text-amber-500/80" />
                        <span className="truncate">{v.name}</span>
                      </button>
                      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-zinc-600 sm:hidden">
                        <span>
                          {v.width}×{v.height}
                        </span>
                        <span>{t('vehicleEditor.list.elementCount', { count: v.elements.length })}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-zinc-600">{v.id}</div>
                      {renderUsage ? <div className="mt-1">{renderUsage(v)}</div> : null}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-zinc-500 sm:table-cell">
                      <span className="inline-flex items-center gap-1">
                        <Maximize2 size={11} />
                        {v.width}×{v.height}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-500 md:table-cell">
                      {v.elements.length}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-zinc-500 lg:table-cell">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} />
                        {formatDate(v.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title={t('vehicleEditor.list.openEdit')}
                          onClick={() => onSelect(v.id)}
                          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          title={t('vehicleEditor.list.duplicate')}
                          disabled={readOnly}
                          onClick={() => onDuplicate(v.id)}
                          className="rounded-lg p-2 text-zinc-400 hover:bg-cyan-500/15 hover:text-cyan-300 disabled:opacity-30"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          title={t('vehicleEditor.list.exportOne')}
                          onClick={() => onExportOne(v.id)}
                          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          title={t('vehicleEditor.list.delete')}
                          disabled={readOnly}
                          onClick={() => {
                            if (confirm(t('common.confirmDelete', { name: v.name }))) void onDelete(v.id);
                          }}
                          className="rounded-lg p-2 text-zinc-400 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-center text-[10px] text-zinc-600">
          {t('vehicleEditor.list.footerHint')}
        </p>
      </div>
    </div>
  );
}
