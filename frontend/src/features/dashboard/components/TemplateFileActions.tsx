import { useRef, useState } from 'react';
import { Download, Upload, FileJson } from 'lucide-react';
import type { DashboardPlane } from '../types';
import { buildDashboardTemplate, downloadTemplateJson } from '../template/exportTemplate';
import {
  importDashboardTemplate,
  parseTemplateFile,
} from '../template/importTemplate';
import type { TemplateImportResult } from '../template/types';

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
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg"
      >
        <Download size={16} className="text-cyan-400" />
        匯出樣板 JSON
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      title="匯出為儀表板樣板 JSON（含資料來源連線設定）"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                 border border-zinc-700 text-zinc-400 hover:border-cyan-600 hover:text-cyan-400 transition-colors"
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

export function ImportTemplateButton({ onImported, variant = 'card' }: ImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [applyConnections, setApplyConnections] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const template = parseTemplateFile(json);
      const result = importDashboardTemplate(template, {
        applyTemplateConnections: applyConnections,
        planeName: template.meta?.name,
      });
      onImported(result);
    } catch (e) {
      alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                     border border-zinc-700 text-zinc-400 hover:border-amber-600 hover:text-amber-400 transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {busy ? '匯入中…' : '匯入樣板'}
        </button>
      </>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl border border-dashed border-amber-700/40 bg-amber-950/10"
    >
      <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
        <FileJson size={18} />
        匯入儀表板樣板
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">
        選擇 <code className="text-amber-300/80">.json</code> 樣板檔；檔案開頭的{' '}
        <code className="text-amber-300/80">dataSources</code> 會合併至本機連線設定，並建立新平面。
      </p>
      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
        <input
          type="checkbox"
          checked={applyConnections}
          onChange={e => setApplyConnections(e.target.checked)}
          className="rounded border-zinc-600"
        />
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
                   text-amber-300 text-sm font-bold hover:bg-amber-600/30 transition-colors disabled:opacity-50"
      >
        <Upload size={16} />
        {busy ? '匯入中…' : '選擇樣板檔案'}
      </button>
    </div>
  );
}
