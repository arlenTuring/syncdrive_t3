import { useEffect, useState } from 'react';
import DashboardEditor from './features/dashboard';
import MapEditorApp   from './features/map-editor';
import ScheduleManagementApp from './features/schedule-management';
import { AppSettingsModal } from './components/AppSettingsModal';
import {
  LayoutDashboard, Map, ChevronRight, Route,
  Cpu, Activity, Layers, Settings, CalendarDays,
} from 'lucide-react';

type AppMode = 'home' | 'dashboard' | 'map' | 'trajectory' | 'schedule-management';

// ─── 首頁 ─────────────────────────────────────────────────────────────────────

function HomePage({ onSelect }: { onSelect: (m: AppMode) => void }) {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'radial-gradient(ellipse at 60% 20%, #0f1f3d 0%, #070d18 60%, #030609 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Inter", system-ui, sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 背景裝飾格線 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage:
          'linear-gradient(rgba(6,182,212,0.04) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(6,182,212,0.04) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* 光暈 */}
      <div style={{ position: 'absolute', top: '-10%', left: '30%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* LOGO & 標題 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 32px rgba(14,165,233,0.35)',
        }}>
          <Cpu size={26} color="white" />
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: '#f1f5f9' }}>SyncDrive T3</div>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 2 }}>AGV FLEET MANAGEMENT PLATFORM</div>
        </div>
      </div>

      {/* 副標題 */}
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 48, letterSpacing: 0.3 }}>
        選擇要進入的工作模式
      </p>

      {/* 模式卡片 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', maxWidth: 1320, padding: '0 16px' }}>
        <ModeCard
          icon={<LayoutDashboard size={32} />}
          title="儀表板編輯器"
          subtitle="Dashboard Editor"
          description="建立和管理多頁面監控儀表板，支援資料綁定、Repeater 群組、15+ Widget 類型與即時 MQTT 數據。"
          accent="#6366f1"
          tag="DASHBOARD"
          features={['15+ Widget 元件', '圖台容器 + Map Editor', 'Repeater 畫布群組', '總控大屏內建範例']}
          onClick={() => onSelect('dashboard')}
        />
        <ModeCard
          icon={<Map size={32} />}
          title="地圖編輯器"
          subtitle="Map Editor"
          description="設計和管理場域佈局地圖，支援多種設施類型、Area 架構、版本管理與 MQTT 整合。"
          accent="#0ea5e9"
          tag="MAP"
          features={['場域設施佈局', '地圖清單與版本', 'Area 多區域架構', '地圖描述檔匯入／導出']}
          onClick={() => onSelect('map')}
        />
        <ModeCard
          icon={<Route size={32} />}
          title="軌跡圖台"
          subtitle="Trajectory Platform"
          description="載入車輛軌跡描述檔、回放行駛路徑，並比對地圖座標系是否一致。"
          accent="#14b8a6"
          tag="TRAJECTORY"
          features={['車輛軌跡回放', '原始數據檢視', '地圖座標對照', '多車輛軌跡目錄']}
          onClick={() => onSelect('trajectory')}
        />
        <ModeCard
          icon={<CalendarDays size={32} />}
          title="班表管理模組"
          subtitle="Schedule Management"
          description="管理班次運行紀錄、時間模板、班表清單與整備任務，作為班表系統的規劃與營運入口。"
          accent="#f59e0b"
          tag="SCHEDULE"
          features={['班次運行紀錄', '時間模板管理', '班表清單管理', '整備任務管理']}
          onClick={() => onSelect('schedule-management')}
        />
      </div>

      {/* 底部 */}
      <div style={{ position: 'absolute', bottom: 24, color: '#1e293b', fontSize: 11, letterSpacing: 1 }}>
        <Activity size={12} style={{ display: 'inline', marginRight: 5 }} />
        SYNCDRIVE T3 · ALL SYSTEMS NOMINAL
      </div>
    </div>
  );
}

function hexToRgbTuple(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '99,102,241';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function ModeCard({
  icon, title, subtitle, description, accent, tag, features, onClick,
}: {
  icon: React.ReactNode; title: string; subtitle: string;
  description: string; accent: string; tag: string;
  features: string[]; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 300, padding: '32px 28px',
        background: hovered
          ? `linear-gradient(145deg, rgba(${hexToRgbTuple(accent)},0.12) 0%, rgba(15,23,42,0.9) 100%)`
          : 'rgba(15,23,42,0.7)',
        border: `1.5px solid ${hovered ? accent + 'aa' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 20,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        transform: hovered ? 'translateY(-6px)' : 'none',
        boxShadow: hovered ? `0 20px 60px ${accent}25, 0 0 0 1px ${accent}30` : '0 4px 20px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(12px)',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* 光暈效果 */}
      {hovered && (
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${accent}15 0%, transparent 70%)`, pointerEvents: 'none' }} />
      )}

      {/* Tag */}
      <div style={{ position: 'absolute', top: 16, right: 16, padding: '2px 8px', borderRadius: 6, background: `${accent}20`, border: `1px solid ${accent}40`, color: accent, fontSize: 9, fontWeight: 700, letterSpacing: 2, fontFamily: 'monospace' }}>
        {tag}
      </div>

      {/* Icon */}
      <div style={{ width: 56, height: 56, borderRadius: 14, background: `${accent}18`, border: `1px solid ${accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, marginBottom: 20 }}>
        {icon}
      </div>

      {/* Title */}
      <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 10, color: accent, marginBottom: 12, letterSpacing: 1.5, fontWeight: 600 }}>{subtitle}</div>

      {/* Description */}
      <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>{description}</p>

      {/* Features */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#94a3b8' }}>
            <Layers size={10} color={accent} />
            {f}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: accent, fontSize: 12, fontWeight: 600 }}>
        進入 {title}
        <ChevronRight size={14} style={{ transition: 'transform 0.2s', transform: hovered ? 'translateX(4px)' : 'none' }} />
      </div>
    </button>
  );
}

// ─── 根元件 ─────────────────────────────────────────────────────────────────────

function GlobalSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="應用程式設定（還原範例／清除暫存）"
      aria-label="應用程式設定"
      style={{
        position: 'fixed',
        top: 20,
        left: 20,
        zIndex: 9998,
        width: 40,
        height: 40,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(8px)',
        color: '#94a3b8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'color 0.15s, border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = '#22d3ee';
        e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = '#94a3b8';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
      }}
    >
      <Settings size={20} />
    </button>
  );
}

function App() {
  const [mode, setMode] = useState<AppMode>('home');
  const [showAppSettings, setShowAppSettings] = useState(false);

  useEffect(() => {
    if (mode !== 'home') setShowAppSettings(false);
  }, [mode]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {mode === 'home' && (
        <>
          <GlobalSettingsButton onClick={() => setShowAppSettings(true)} />
          <HomePage onSelect={setMode} />
        </>
      )}
      {showAppSettings && mode === 'home' && (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      )}

      {mode === 'dashboard' ? (
        <div className="flex h-full min-h-0 w-full">
          <DashboardEditor onBackToHome={() => setMode('home')} />
        </div>
      ) : null}

      <div style={{ display: mode === 'map' ? 'block' : 'none', width: '100%', height: '100%' }}>
        <MapEditorApp workspace="map" onBackToHome={() => setMode('home')} />
      </div>

      <div style={{ display: mode === 'trajectory' ? 'block' : 'none', width: '100%', height: '100%' }}>
        <MapEditorApp workspace="trajectory" onBackToHome={() => setMode('home')} />
      </div>

      {mode === 'schedule-management' ? (
        <div className="flex h-full min-h-0 w-full">
          <ScheduleManagementApp onBackToHome={() => setMode('home')} />
        </div>
      ) : null}

    </div>
  );
}

export default App;
