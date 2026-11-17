import { useRef, useState } from 'react';
import { Download, Upload, FileJson } from 'lucide-react';
import type { DashboardPlane } from '../types';
import { buildDashboardTemplate, downloadTemplateJson } from '../template/exportTemplate';
import {
  importDashboardTemplate,
  parseTemplateFile,
} from '../template/importTemplate';
import type { TemplateImportResult } from '../template/types';
import { systemAlert } from '../../../lib/systemDialog';
import { Button, Checkbox } from '../../../components/ui';

interface ExportProps {
  plane: DashboardPlane;
  variant?: 'button' | 'menu-item';
}

export function ExportTemplateButton({ plane, variant = 'button' }: ExportProps) {
  const handleExport = () => {
    const template = buildDashboardTemplate(plane);
    downloadTemplateJson(template);
  };

  if (variant === 'menu-item') {
    return (
      <button
        type="button"
        onClick={handleExport}
        className="flex items-center gap-2 w-full px-3 py-2 text-body-s text-text-secondary hover:bg-link-standard-hover rounded-lg"
      >
        <Download size={16} className="text-text-theme" />
        匯出樣板 JSON
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      title="匯出為儀表板樣板 JSON（含資料來源連線設定）"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-xs font-bold
                 border border-border-quaternary text-text-tertiary hover:border-cyan-600 hover:text-text-theme transition-colors"
    >
      <Download size={14} />
      匯出樣板
    </button>
  );
}

interface ImportProps {
  onImported: (result: TemplateImportResult) => void;
  variant?: 'card' | 'button';
}

/** 匯入樣板的流程（選檔、解析、合併連線設定）；按鈕、卡片與對話框共用，不各寫一套 */
function useTemplateImport(onImported: (result: TemplateImportResult) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [applyConnections, setApplyConnections] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const template = parseTemplateFile(json);
      const result = await importDashboardTemplate(template, {
        applyTemplateConnections: applyConnections,
        planeName: template.meta?.name,
      });
      onImported(result);
    } catch (e) {
      void systemAlert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return { inputRef, applyConnections, setApplyConnections, busy, handleFile };
}

/**
 * 匯入儀表板的小型對話框：選項與卡片版相同（覆寫同 ID 連線 URL 預設不勾，勾了才覆寫），
 * 說明寫清楚會發生什麼，不因為介面簡化而默默覆寫。
 */
export function ImportTemplateDialog({ onImported, onClose }: { onImported: (result: TemplateImportResult) => void; onClose: () => void }) {
  const { inputRef, applyConnections, setApplyConnections, busy, handleFile } = useTemplateImport(onImported);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black-50" role="dialog" aria-modal="true" aria-label="匯入儀表板">
      <div className="w-[440px] max-w-[92vw] rounded-2xl border border-[rgba(212,212,212,0.15)] bg-surface-primary p-5 text-text-primary shadow-xl">
        <div className="flex items-center gap-2 text-body-m-bold">
          <FileJson size={18} className="text-text-theme" />
          匯入儀表板
        </div>
        <p className="mt-3 text-body-xs text-text-tertiary">
          選擇 <code className="text-text-secondary">.json</code> 樣板檔，會建立一個新的儀表板。檔案開頭的{' '}
          <code className="text-text-secondary">dataSources</code> 會合併到本機連線設定。
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-[rgba(212,212,212,0.1)] p-3 text-body-s text-text-secondary">
          <Checkbox checked={applyConnections} onCheckedChange={e => setApplyConnections(e)} />
          <span>
            以樣板覆寫同 ID 的連線 URL（資料庫／MQTT 位址）
            <span className="mt-1 block text-body-xs text-text-tertiary">
              {applyConnections ? '會覆寫：同 ID 的連線改成樣板裡的位址。' : '不覆寫：同 ID 的連線保留本機目前的位址。'}
            </span>
          </span>
        </label>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div className="mt-4 flex justify-end gap-3">
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>取消</Button>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-link-theme-filled px-3.5 text-body-s-bold text-text-primary hover:bg-link-theme-filled-hover disabled:opacity-50"
          >
            <Upload size={16} />
            {busy ? '匯入中…' : '選擇樣板檔案'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImportTemplateButton({ onImported, variant = 'card' }: ImportProps) {
  const { inputRef, applyConnections, setApplyConnections, busy, handleFile } = useTemplateImport(onImported);

  if (variant === 'button') {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          title="匯入儀表板樣板 JSON"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-xs font-bold
                     border border-border-quaternary text-text-tertiary hover:border-amber-600 hover:text-status-warning transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {busy ? '匯入中…' : '匯入樣板'}
        </button>
      </>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl border border-dashed border-status-warning-light bg-amber-950/10"
    >
      <div className="flex items-center gap-2 text-status-warning text-body-s-bold">
        <FileJson size={18} />
        匯入儀表板樣板
      </div>
      <p className="text-body-xs text-text-quaternary">
        選擇 <code className="text-amber-300/80">.json</code> 樣板檔；檔案開頭的{' '}
        <code className="text-amber-300/80">dataSources</code> 會合併至本機連線設定，並建立新平面。
      </p>
      <label className="flex items-center gap-2 text-body-xs text-text-tertiary cursor-pointer">
        <Checkbox checked={applyConnections} onCheckedChange={e => setApplyConnections(e)} />
        以樣板覆寫同 ID 的連線 URL（資料庫 / MQTT 位址）
      </label>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-600/20 border border-amber-600/40
                   text-status-warning text-body-s font-bold hover:bg-amber-600/30 transition-colors disabled:opacity-50"
      >
        <Upload size={16} />
        {busy ? '匯入中…' : '選擇樣板檔案'}
      </button>
    </div>
  );
}
