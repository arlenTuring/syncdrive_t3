import { useState } from 'react';
import { X, Database, Plus, Trash2, CheckCircle, AlertCircle, Loader, Edit2, Save } from 'lucide-react';
import {
  useDataSourceStore,
  seedDashboardAll,
  getDataSourceTypeLabel,
  type DataSourceConfig,
  type DataSourceType,
} from '../store/useDataSourceStore';

interface Props { 
  onClose: () => void; 
  onClearAll: () => void;
}

type PingState = 'idle' | 'loading' | 'ok' | 'error';

const DATA_SOURCE_SECTIONS: {
  type: DataSourceType;
  title: string;
  hint: string;
}[] = [
  {
    type: 'internal',
    title: 'SQL 資料庫',
    hint: '供元件「數據綁定 → SQL」使用：選資料表、撰寫 SELECT，經後端查 PostgreSQL。',
  },
  {
    type: 'mqtt',
    title: 'MQTT 即時',
    hint: '供元件「數據綁定 → MQTT」使用：Socket.IO 轉發 VTMS 主題，需再設定 Topic 與 JSON 路徑。',
  },
];

const inputCls = `w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

export function SettingsModal({ onClose, onClearAll }: Props) {
  const { dataSources, addDataSource, updateDataSource, deleteDataSource } = useDataSourceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pingStates, setPingStates] = useState<Record<string, PingState>>({});
  const [activeTab, setActiveTab] = useState<'datasource' | 'general'>('datasource');
  const [seedState, setSeedState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // ─── Ping 測試 ─────────────────────────────────────────────────
  async function pingDataSource(ds: DataSourceConfig) {
    if (ds.type !== 'internal') return;
    setPingStates(p => ({ ...p, [ds.id]: 'loading' }));
    try {
      const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/ping`);
      const { ok } = await res.json();
      setPingStates(p => ({ ...p, [ds.id]: ok ? 'ok' : 'error' }));
    } catch {
      setPingStates(p => ({ ...p, [ds.id]: 'error' }));
    }
    setTimeout(() => setPingStates(p => ({ ...p, [ds.id]: 'idle' })), 4000);
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 backdrop-blur-sm"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex gap-4">
            <button onClick={() => setActiveTab('datasource')} className={`text-sm font-semibold transition-colors pb-4 border-b-2 -mb-4 ${activeTab === 'datasource' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>資料來源</button>
            <button onClick={() => setActiveTab('general')} className={`text-sm font-semibold transition-colors pb-4 border-b-2 -mb-4 ${activeTab === 'general' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>一般設定</button>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {activeTab === 'datasource' ? (
            <>
              {/* 說明 */}
              <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg px-4 py-3 text-xs text-purple-300 leading-relaxed">
                資料來源依類型分類管理。元件的「數據綁定」分頁只會列出對應類型：SQL 僅能選 SQL 資料庫，MQTT 僅能選 MQTT 連線。
              </div>

              {DATA_SOURCE_SECTIONS.map(section => {
                const sectionSources = dataSources.filter(ds => ds.type === section.type);
                return (
                  <div key={section.type} className="space-y-2">
                    <div className="flex items-center gap-2 pt-1">
                      <h3 className="text-zinc-300 text-sm font-semibold">{section.title}</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                        {getDataSourceTypeLabel(section.type)}
                      </span>
                    </div>
                    <p className="text-zinc-500 text-xs leading-relaxed -mt-1">{section.hint}</p>
                    {sectionSources.length === 0 ? (
                      <div className="text-zinc-600 text-xs px-3 py-2 border border-dashed border-zinc-700 rounded-lg">
                        尚無此類資料來源
                      </div>
                    ) : (
                      sectionSources.map(ds => (
                        <DataSourceCard
                          key={ds.id}
                          ds={ds}
                          pingState={pingStates[ds.id] ?? 'idle'}
                          isEditing={editingId === ds.id}
                          onEdit={() => setEditingId(editingId === ds.id ? null : ds.id)}
                          onSave={(patch) => { updateDataSource(ds.id, patch); setEditingId(null); }}
                          onDelete={() => deleteDataSource(ds.id)}
                          onPing={() => pingDataSource(ds)}
                        />
                      ))
                    )}
                  </div>
                );
              })}

              {/* 新增表單 */}
              {showAddForm
                ? <AddDataSourceForm
                    onAdd={(cfg) => { addDataSource(cfg); setShowAddForm(false); }}
                    onCancel={() => setShowAddForm(false)}
                  />
                : (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full py-3 border-2 border-dashed border-zinc-700 rounded-xl text-zinc-500 text-sm
                               hover:border-purple-600 hover:text-purple-400 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={16} /> 新增資料來源
                  </button>
                )
              }
            </>
          ) : (
            <div className="space-y-6">
              <div className="p-4 border border-zinc-700/60 bg-zinc-800/30 rounded-xl">
                <div className="text-zinc-300 text-sm font-semibold">還原內建範例</div>
                <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
                  請使用畫面左上角齒輪「應用程式設定」→「還原兩個圖台範例」（儀表板與地圖編輯器一次還原）。
                </p>
              </div>
              <div>
                <h3 className="text-zinc-200 text-sm font-semibold mb-2">示範資料</h3>
                <div className="p-4 border border-cyan-900/30 bg-cyan-950/10 rounded-xl flex items-center justify-between gap-4">
                  <div>
                    <div className="text-cyan-300 text-sm font-bold">載入示範資料到資料庫</div>
                    <div className="text-zinc-500 text-xs mt-1">寫入 11 台車輛、事件、正線／整備班次卡、運能與整備分佈。需後端運行中。</div>
                  </div>
                  <button
                    type="button"
                    disabled={seedState === 'loading'}
                    onClick={async () => {
                      setSeedState('loading');
                      try {
                        await seedDashboardAll();
                        setSeedState('ok');
                        alert('示範資料已寫入資料庫。請重新整理儀表板；若仍無資料，請用左上角齒輪「還原兩個圖台範例」。');
                      } catch (e: unknown) {
                        setSeedState('error');
                        alert(e instanceof Error ? e.message : '載入失敗，請確認後端已啟動');
                      }
                      setTimeout(() => setSeedState('idle'), 3000);
                    }}
                    className="px-4 py-2 rounded-lg bg-cyan-600/20 border border-cyan-600/40 text-cyan-300 text-xs font-bold uppercase hover:bg-cyan-600 hover:text-white transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    {seedState === 'loading' ? '載入中…' : seedState === 'ok' ? '已載入' : seedState === 'error' ? '失敗' : '載入資料'}
                  </button>
                </div>
              </div>
              <div>
                <h3 className="text-zinc-200 text-sm font-semibold mb-2">危險區域 (Danger Zone)</h3>
                <div className="p-4 border border-red-900/30 bg-red-950/10 rounded-xl space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-red-400 text-sm font-bold">清除所有平面與元件</div>
                      <div className="text-zinc-500 text-xs mt-1">此操作將永久刪除 localStorage 中儲存的所有儀表板配置，且無法還原。</div>
                    </div>
                    <button 
                      onClick={() => { if(confirm('確定要清空所有資料嗎？這將刪除所有已建立的平面。')) { onClearAll(); onClose(); } }}
                      className="px-4 py-2 rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 text-xs font-bold uppercase hover:bg-red-600 hover:text-white transition-all whitespace-nowrap"
                    >
                      立即清空
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm
                       hover:border-zinc-500 transition-colors">
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 資料來源卡片 ───────────────────────────────────────────────────

function DataSourceCard({ ds, pingState, isEditing, onEdit, onSave, onDelete, onPing }: {
  ds: DataSourceConfig;
  pingState: PingState;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<DataSourceConfig>) => void;
  onDelete: () => void;
  onPing: () => void;
}) {
  const [form, setForm] = useState({
    name: ds.name,
    backendUrl: ds.backendUrl,
    description: ds.description,
    mqttTopic: ds.mqttTopic ?? '',
  });
  const isDefault = ds.id === 'default-internal' || ds.id === 'default-mqtt';

  const pingIcon = {
    idle: null,
    loading: <Loader size={13} className="animate-spin text-yellow-400" />,
    ok: <CheckCircle size={13} className="text-green-400" />,
    error: <AlertCircle size={13} className="text-red-400" />,
  }[pingState];

  const pingLabel = {
    idle: '測試連線',
    loading: '測試中…',
    ok: '連線正常',
    error: '連線失敗',
  }[pingState];

  return (
    <div className="border border-zinc-700/60 rounded-xl bg-zinc-800/30 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-purple-900/40 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
          <Database size={14} className="text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-zinc-200 text-sm font-medium truncate">{ds.name}</span>
            {isDefault && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-800/40">預設</span>}
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
              {ds.type === 'internal' ? 'PostgreSQL' : ds.type === 'mqtt' ? 'Socket.IO' : 'REST'}
            </span>
          </div>
          <div className="text-zinc-500 text-xs mt-0.5 truncate">
            {ds.type === 'internal' ? ds.backendUrl : ''} {ds.description && `· ${ds.description}`}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {ds.type === 'internal' && (
            <button onClick={onPing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-600
                         text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors">
              {pingIcon ?? <CheckCircle size={12} />} {pingLabel}
            </button>
          )}
          {!isDefault && (
            <>
              <button onClick={onEdit} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
                <Edit2 size={13} />
              </button>
              <button onClick={onDelete} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                <Trash2 size={13} />
              </button>
            </>
          )}
          {isDefault && (
            <button onClick={onEdit} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
              <Edit2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {isEditing && (
        <div className="border-t border-zinc-700/60 px-4 py-4 space-y-3 bg-zinc-800/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-500 text-xs mb-1">名稱</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1">後端 URL</label>
              <input value={form.backendUrl} onChange={e => setForm(f => ({ ...f, backendUrl: e.target.value }))} className={inputCls} placeholder="http://localhost:3000" />
            </div>
          </div>
          {ds.type === 'mqtt' && (
            <div>
              <label className="block text-zinc-500 text-xs mb-1">預設訂閱主題（選填）</label>
              <input
                value={form.mqttTopic ?? ''}
                onChange={e => setForm(f => ({ ...f, mqttTopic: e.target.value }))}
                className={inputCls}
                placeholder="v1/vtms/+/telemetry/update"
              />
            </div>
          )}
          <div>
            <label className="block text-zinc-500 text-xs mb-1">說明（選填）</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => onSave(form)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-600 text-white text-xs hover:bg-purple-500 transition-colors">
              <Save size={12} /> 儲存
            </button>
            <button onClick={onEdit}
              className="px-4 py-1.5 rounded-lg border border-zinc-600 text-zinc-400 text-xs hover:text-zinc-200 transition-colors">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 新增資料來源表單 ───────────────────────────────────────────────

function AddDataSourceForm({ onAdd, onCancel }: {
  onAdd: (cfg: Omit<DataSourceConfig, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'internal' as DataSourceType,
    backendUrl: 'http://localhost:3000',
    description: '',
    mqttTopic: 'v1/vtms/+/telemetry/update',
  });

  return (
    <div className="border-2 border-purple-700/40 rounded-xl bg-purple-900/10 p-4 space-y-3">
      <h3 className="text-purple-300 text-sm font-medium">新增資料來源</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-zinc-500 text-xs mb-1">名稱 *</label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls}
            placeholder={form.type === 'mqtt' ? '我的 MQTT' : '我的資料庫'}
          />
        </div>
        <div>
          <label className="block text-zinc-500 text-xs mb-1">類型 *</label>
          <select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as DataSourceType }))}
            className={inputCls}
          >
            <option value="internal">SQL — PostgreSQL（透過後端）</option>
            <option value="mqtt">MQTT — Socket.IO 轉發</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-zinc-500 text-xs mb-1">後端 URL *</label>
        <input value={form.backendUrl} onChange={e => setForm(f => ({ ...f, backendUrl: e.target.value }))} className={inputCls} placeholder="http://localhost:3000" />
      </div>
      {form.type === 'mqtt' && (
        <div>
          <label className="block text-zinc-500 text-xs mb-1">預設訂閱主題（選填）</label>
          <input
            value={form.mqttTopic}
            onChange={e => setForm(f => ({ ...f, mqttTopic: e.target.value }))}
            className={inputCls}
            placeholder="v1/vtms/+/telemetry/update"
          />
        </div>
      )}
      <div>
        <label className="block text-zinc-500 text-xs mb-1">說明（選填）</label>
        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            if (!form.name || !form.backendUrl) return;
            const { mqttTopic, ...rest } = form;
            onAdd(
              rest.type === 'mqtt'
                ? { ...rest, mqttTopic: mqttTopic || undefined }
                : rest,
            );
          }}
          disabled={!form.name || !form.backendUrl}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-xs hover:bg-purple-500 disabled:opacity-40 transition-colors"
        >
          <Plus size={12} /> 新增
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-400 text-xs hover:text-zinc-200 transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}
