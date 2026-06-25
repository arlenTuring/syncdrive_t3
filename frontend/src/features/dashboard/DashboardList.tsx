import { Plus, Monitor, Trash2, Calendar, Maximize2, LayoutGrid } from 'lucide-react';
import type { DashboardPlane } from './types';
import { ImportTemplateButton } from './components/TemplateFileActions';
import type { TemplateImportResult } from './template/types';

interface Props {
  planes: DashboardPlane[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onImportTemplate: (result: TemplateImportResult) => void;
}

export function DashboardList({ planes, onSelect, onCreate, onDelete, onImportTemplate }: Props) {
  const formatDate = (ts: number) => {
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(ts));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0a0f1a] p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-end justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <LayoutGrid className="text-cyan-500" size={32} />
              儀表板管理
            </h1>
            <p className="text-zinc-500 mt-2 text-sm">
              選擇現有的平面開始編輯，或建立一個新的監控視窗。
            </p>
          </div>
          <div className="text-zinc-600 text-xs font-mono uppercase tracking-widest">
            {planes.length} 份平面已儲存
          </div>
        </div>

        <ImportTemplateButton onImported={onImportTemplate} />

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Create New Card */}
          <button 
            onClick={onCreate}
            className="group relative flex flex-col items-center justify-center gap-4 h-[220px] 
                       bg-zinc-900/40 border-2 border-dashed border-zinc-800 rounded-2xl
                       hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all duration-300"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center
                          group-hover:bg-cyan-500 group-hover:text-white transition-colors">
              <Plus size={24} />
            </div>
            <div className="text-center">
              <div className="text-zinc-300 font-semibold group-hover:text-cyan-400">建立新平面</div>
              <div className="text-zinc-600 text-xs mt-1">自定義解析度與比例</div>
            </div>
          </button>

          {/* Plane Cards */}
          {planes.map(p => (
            <div 
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="group relative flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl 
                         overflow-hidden cursor-pointer hover:border-zinc-600 hover:shadow-2xl 
                         hover:shadow-cyan-500/10 transition-all duration-300"
            >
              {/* Preview Placeholder */}
              <div className="h-32 bg-zinc-950 flex items-center justify-center border-b border-zinc-800 group-hover:bg-zinc-900 transition-colors">
                <Monitor size={48} className="text-zinc-800 group-hover:text-cyan-900 transition-colors" />
                
                {/* Overlay Actions */}
                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => { e.stopPropagation(); if(confirm('確定要刪除此平面嗎？')) onDelete(p.id); }}
                    className="p-2 rounded-lg bg-red-950/50 text-red-400 border border-red-900/50 hover:bg-red-600 hover:text-white transition-all"
                    title="刪除平面"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-zinc-100 text-lg truncate group-hover:text-cyan-400 transition-colors">{p.name}</div>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px] font-mono">
                    <Maximize2 size={10} /> {p.width} × {p.height}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                    <Calendar size={12} />
                    {formatDate(p.updatedAt || p.createdAt)}
                  </div>
                </div>

                <div className="pt-2">
                  <div className="w-full py-2 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-bold uppercase 
                                tracking-wider text-center group-hover:bg-cyan-600 group-hover:text-white transition-all">
                    進入編輯模式
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer info if empty */}
        {planes.length === 0 && (
          <div className="text-center py-20">
            <p className="text-zinc-600 italic">目前沒有任何平面，點擊上方按鈕開始您的第一個設計。</p>
          </div>
        )}
      </div>
    </div>
  );
}
