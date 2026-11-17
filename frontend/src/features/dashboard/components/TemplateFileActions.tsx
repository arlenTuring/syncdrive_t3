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
import { Button, Checkbox, Dialog } from '../../../components/ui';

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
      <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Download />} onPress={handleExport}>匯出樣板 JSON</Button>
    );
  }

  return (
    <Button variant="outlined" leadingIcon={<Download />} onPress={handleExport} title="匯出為儀表板樣板 JSON（含資料來源連線設定）">匯出樣板</Button>
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
    <Dialog
      title={<span className="inline-flex items-center gap-2"><FileJson size={18} className="text-text-theme" aria-hidden />匯入儀表板</span>}
      onClose={onClose}
      widthClassName="w-[440px] max-w-[92vw]"
      footer={(
        <>
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>取消</Button>
          <Button leadingIcon={<Upload />} disabled={busy} onPress={() => inputRef.current?.click()}>{busy ? '匯入中…' : '選擇樣板檔案'}</Button>
        </>
      )}
    >
<div className="text-text-primary">
        <p className="text-body-xs text-text-tertiary">
          選擇 <code className="text-text-secondary">.json</code> 樣板檔，會建立一個新的儀表板。檔案開頭的{' '}
          <code className="text-text-secondary">dataSources</code> 會合併到本機連線設定。
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border-quaternary p-3 text-body-s text-text-secondary">
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
      </div>
</Dialog>
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
        <Button hierarchy="subordinate" variant="outlined" leadingIcon={<Upload />} disabled={busy} onPress={() => inputRef.current?.click()} title="匯入儀表板樣板 JSON">{busy ? '匯入中…' : '匯入樣板'}</Button>
      </>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl border border-dashed border-status-warning-light bg-status-warning-light"
    >
      <div className="flex items-center gap-2 text-status-warning text-body-s-bold">
        <FileJson size={18} />
        匯入儀表板樣板
      </div>
      <p className="text-body-xs text-text-quaternary">
        選擇 <code className="text-status-warning">.json</code> 樣板檔；檔案開頭的{' '}
        <code className="text-status-warning">dataSources</code> 會合併至本機連線設定，並建立新平面。
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
      <Button hierarchy="subordinate" variant="outlined" leadingIcon={<Upload />} disabled={busy} onPress={() => inputRef.current?.click()}>{busy ? '匯入中…' : '選擇樣板檔案'}</Button>
    </div>
  );
}
