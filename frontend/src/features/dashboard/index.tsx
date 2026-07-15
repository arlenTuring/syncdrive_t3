import { useState, useEffect, useCallback, useRef, useMemo } from 'react'; // HMR Trigger
import { useDashboardEditor } from './useDashboardEditor';
import { NewPlaneDialog } from './NewPlaneDialog';
import { PlaneWorkspace } from './PlaneWorkspace';
import { PropertiesPanel } from './PropertiesPanel';
import { ComponentPalette } from './ComponentPalette';
import { SettingsModal } from './settings/SettingsModal';
import { DashboardList } from './DashboardList';
import { Plus, Monitor, LayoutGrid, Save, Settings, Copy, Pencil, ArrowLeft, Undo2, Redo2, Paintbrush, LogOut } from 'lucide-react';
import { VehicleEditorEmbed } from '../vehicle-editor/VehicleEditorEmbed';
import type { CanvasElementProps, ChildWidget, WidgetType } from './types';
import { BindingHealthProvider } from './context/BindingHealthContext';
import { FormatPainterProvider } from './context/FormatPainterContext';
import { canApplyWidgetFormat } from './utils/widgetFormatPainter';
import { BindingIssuesBar } from './components/BindingIssuesBar';
import { BackToHomeButton } from '../../components/BackToHomeButton';
import { SimulationTransportToolbar } from './components/SimulationTransportToolbar';
import { ExportTemplateButton, ImportTemplateButton } from './components/TemplateFileActions';
import { GroupTemplateExitDialog } from './components/GroupTemplateExitDialog';
import { notifyCloseCanvasChildList } from './utils/canvasChildList';
import { VariableProvider } from './VariableContext';
import { DemoSimulationProvider } from './context/DemoSimulationContext';
import { VehicleFleetMqttProvider } from './context/VehicleFleetMqttContext';
import {
  buildGroupIndexPreviewVariables,
  computeSubcanvasEditPlane,
} from './utils/groupTemplateContext';
import {
  TEMPLATE_CANVAS_DEFAULT,
  TEMPLATE_CANVAS_NORMAL,
  TEMPLATE_CANVAS_LEGACY,
  TEMPLATE_GATE_SETTINGS,
  computeDualSubcanvasEditPlane,
  findChildInGroup,
  getDefaultChildren,
  getNormalChildren,
  isDualCanvasGroup,
  laneFromTemplateCanvasId,
  type DualCanvasLane,
} from './utils/dualCanvas';

function cloneCanvasElement(el: CanvasElementProps): CanvasElementProps {
  return JSON.parse(JSON.stringify(el)) as CanvasElementProps;
}

export default function DashboardEditor({ onBackToHome }: { onBackToHome?: () => void }) {
  const {
    planes, activePlane, setActivePlaneId,
    selectedElementId, selectedElement, selectedElementIds,
    selectedChildId, selectedChild, selectedChildIds,
    selectElement, selectElements, selectChild, selectChildren,
    createPlane, updatePlane, deletePlane, importPlane,
    addCanvasElement, updateElement, updateElementsBatch, deleteElement,
    addChildWidget, updateChildWidget, updateChildrenBatch,
    deleteChildWidget, deleteChildrenBatch, deleteElementsBatch,
    clipboard, copySelected, pasteClipboard,
    formatPainter,
    armFormatPainter, cancelFormatPainter, applyFormatPainter,
    clearAllData,
    recordHistory, undo, redo, resetHistory, canUndo, canRedo,
  } = useDashboardEditor();

  const propertyHistoryRecordedRef = useRef(false);

  const [view, setView] = useState<'list' | 'editor'>('list');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  /** 圖台內載具容器：進入內嵌載具編輯器 */
  /** 載具容器內嵌編輯（與儀表板畫布選取分離，僅由此狀態驅動 UI） */
  const [editingVehicleContainer, setEditingVehicleContainer] = useState<{
    canvasId: string;
    childId: string;
  } | null>(null);
  /** 進入子畫布編輯當下的群組快照，供「不儲存退出」還原 */
  const [groupEditSnapshot, setGroupEditSnapshot] = useState<CanvasElementProps | null>(null);
  const [showGroupExitDialog, setShowGroupExitDialog] = useState(false);
  /** 雙畫板子畫布：目前選中的虛擬畫布 id（預設／閘道／常態） */
  const [dualEditFocusId, setDualEditFocusId] = useState(TEMPLATE_CANVAS_NORMAL);
  // T1-E: React state-driven save feedback (replaces imperative DOM manipulation)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const toggleEditMode = useCallback(() => {
    setIsEditMode(v => {
      const next = !v;
      if (!next) {
        cancelFormatPainter();
        selectElement(null);
        setEditingGroupId(null);
        setGroupEditSnapshot(null);
        setShowGroupExitDialog(false);
        resetHistory();
      }
      return next;
    });
  }, [selectElement, resetHistory, cancelFormatPainter]);

  const enterEditGroupMode = useCallback((groupId: string) => {
    const group = activePlane?.elements.find(e => e.id === groupId);
    if (!group) return;
    setGroupEditSnapshot(cloneCanvasElement(group));
    setEditingGroupId(groupId);
    setIsEditMode(true);
    selectElement(groupId);
  }, [activePlane, selectElement]);

  const closeGroupEdit = useCallback((opts?: { selectGroupId?: string | null }) => {
    setGroupEditSnapshot(null);
    setShowGroupExitDialog(false);
    setEditingGroupId(null);
    selectElement(opts?.selectGroupId ?? null);
  }, [selectElement]);

  const saveAndExitGroupEdit = useCallback(() => {
    const keepId = editingGroupId;
    closeGroupEdit({ selectGroupId: keepId });
    setSaveStatus('ok');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }, [editingGroupId, closeGroupEdit]);

  const discardAndExitGroupEdit = useCallback(() => {
    if (groupEditSnapshot && editingGroupId) {
      updateElement(editingGroupId, cloneCanvasElement(groupEditSnapshot));
    }
    closeGroupEdit({ selectGroupId: editingGroupId });
  }, [groupEditSnapshot, editingGroupId, updateElement, closeGroupEdit]);

  useEffect(() => {
    propertyHistoryRecordedRef.current = false;
  }, [selectedElementId, selectedChildId, editingGroupId]);

  /** 進入載具編輯：記住容器 id、清空儀表板選取，畫面切換至 VehicleEditorEmbed */
  const enterEditVehicleContainer = useCallback((canvasId: string, childId: string) => {
    setEditingVehicleContainer({ canvasId, childId });
    setIsEditMode(true);
    selectElement(null);
  }, [selectElement]);

  /** 離開載具編輯：還原至剛才的載具容器選取 */
  const exitEditVehicleContainer = useCallback(() => {
    const keep = editingVehicleContainer;
    setEditingVehicleContainer(null);
    if (keep) {
      selectChild(keep.canvasId, keep.childId);
      selectElement(keep.canvasId);
    }
    setSaveStatus('ok');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }, [editingVehicleContainer, selectChild, selectElement]);

  const editingVehicleContainerWidget = useMemo(() => {
    if (!editingVehicleContainer || !activePlane) return null;
    const canvas = activePlane.elements.find((e) => e.id === editingVehicleContainer.canvasId);
    const child = canvas?.children.find((c) => c.id === editingVehicleContainer.childId);
    if (!child || child.type !== 'vehicle-container') return null;
    return child;
  }, [editingVehicleContainer, activePlane?.elements]);

  /** 容器已被刪除時自動離開載具編輯 */
  useEffect(() => {
    if (editingVehicleContainer && !editingVehicleContainerWidget) {
      setEditingVehicleContainer(null);
    }
  }, [editingVehicleContainer, editingVehicleContainerWidget]);

  useEffect(() => {
    const g = activePlane?.elements.find(e => e.id === editingGroupId);
    setDualEditFocusId(
      isDualCanvasGroup(g ?? null) ? TEMPLATE_CANVAS_NORMAL : TEMPLATE_CANVAS_LEGACY,
    );
  }, [editingGroupId, activePlane?.elements]);

  const editingGroup = editingGroupId ? activePlane?.elements.find(e => e.id === editingGroupId) : null;

  const activeDualLane = useCallback((): DualCanvasLane | null => {
    if (!editingGroup?.dualCanvasEnabled) return null;
    const lane = laneFromTemplateCanvasId(dualEditFocusId);
    return lane === 'default' || lane === 'normal' ? lane : null;
  }, [editingGroup, dualEditFocusId]);

  const subcanvasLane = useMemo((): DualCanvasLane | null => {
    if (!editingGroup?.dualCanvasEnabled) return null;
    const lane = laneFromTemplateCanvasId(dualEditFocusId);
    return lane === 'default' || lane === 'normal' ? lane : null;
  }, [editingGroup, dualEditFocusId]);

  const panelSelectedChild = useMemo((): ChildWidget | null => {
    if (selectedChildIds.length !== 1) return null;
    if (editingGroup) {
      return findChildInGroup(editingGroup, selectedChildId, subcanvasLane);
    }
    return selectedChild;
  }, [editingGroup, selectedChild, selectedChildId, selectedChildIds.length, subcanvasLane]);

  const activeSelectedChildIds = useMemo(() => {
    if (editingGroup) return selectedChildIds;
    return selectedElementIds.length === 1 ? selectedChildIds : [];
  }, [editingGroup, selectedChildIds, selectedElementIds.length]);

  // 鍵盤複製貼上、刪除、復原／重做 (僅在編輯器模式生效)
  useEffect(() => {
    if (view !== 'editor') return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;

      // 載具容器內嵌編輯：快捷鍵由 VehicleEditorEmbed 處理，避免 Delete 誤刪容器本身
      if (editingVehicleContainer) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleEditMode(); return; }
      if (!isEditMode && !editingGroupId) return;

      if (isMod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (isMod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (isMod && e.key === 'c') {
        e.preventDefault();
        copySelected(
          editingGroup ? panelSelectedChild : selectedChild,
          editingGroup ? editingGroupId : selectedElement?.id,
        );
        return;
      }
      if (isMod && e.key === 'v') {
        e.preventDefault();
        pasteClipboard(editingGroup?.dualCanvasEnabled ? activeDualLane() : null);
        return;
      }
      if (e.key === 'Escape' && formatPainter) {
        e.preventDefault();
        cancelFormatPainter();
        return;
      }
      if (
        !isMod
        && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const step = 0.5;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const nudge = (x: number, y: number) => ({
          x: Math.round((x + dx) * 2) / 2,
          y: Math.round((y + dy) * 2) / 2,
        });

        if (editingGroupId && activeSelectedChildIds.length > 0) {
          e.preventDefault();
          recordHistory();
          const lane = editingGroup?.dualCanvasEnabled ? activeDualLane() : null;
          const children = activeSelectedChildIds
            .map(id => findChildInGroup(editingGroup!, id, lane))
            .filter((c): c is ChildWidget => !!c);
          updateChildrenBatch(
            editingGroupId,
            children.map(c => ({ childId: c.id, patch: nudge(c.x, c.y) })),
            lane,
          );
          return;
        }

        if (isEditMode && selectedElement && activeSelectedChildIds.length > 0 && !editingGroupId) {
          e.preventDefault();
          recordHistory();
          const children = activeSelectedChildIds
            .map(id => selectedElement.children.find(c => c.id === id))
            .filter((c): c is ChildWidget => !!c);
          updateChildrenBatch(
            selectedElement.id,
            children.map(c => ({ childId: c.id, patch: nudge(c.x, c.y) })),
          );
          return;
        }

        if (isEditMode && selectedElementIds.length > 1 && !editingGroupId) {
          e.preventDefault();
          recordHistory();
          const elements = selectedElementIds
            .map(id => activePlane?.elements.find(el => el.id === id))
            .filter((el): el is CanvasElementProps => !!el);
          updateElementsBatch(
            elements.map(el => ({ elementId: el.id, patch: nudge(el.x, el.y) })),
          );
          return;
        }

        if (isEditMode && selectedElement && activeSelectedChildIds.length === 0 && !editingGroupId) {
          e.preventDefault();
          recordHistory();
          updateElement(selectedElement.id, nudge(selectedElement.x, selectedElement.y));
          return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isMod) {
        e.preventDefault();
        if (editingGroup && activeSelectedChildIds.length > 0 && editingGroupId) {
          deleteChildrenBatch(
            editingGroupId,
            activeSelectedChildIds,
            editingGroup.dualCanvasEnabled ? activeDualLane() : null,
          );
        } else if (activeSelectedChildIds.length > 0 && selectedElement) {
          deleteChildrenBatch(selectedElement.id, activeSelectedChildIds);
        } else if (selectedElementIds.length > 1 && !editingGroup) {
          deleteElementsBatch(selectedElementIds);
        } else if (selectedElement && !editingGroup) {
          deleteElement(selectedElement.id);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    view,
    isEditMode,
    editingVehicleContainer,
    editingGroupId,
    copySelected,
    pasteClipboard,
    formatPainter,
    cancelFormatPainter,
    editingGroup,
    editingGroupId,
    panelSelectedChild,
    activeSelectedChildIds,
    activeDualLane,
    activePlane?.elements,
    selectedChild,
    selectedElement,
    selectedElementIds,
    editingGroup,
    deleteChildWidget,
    deleteChildrenBatch,
    deleteElementsBatch,
    deleteElement,
    toggleEditMode,
    undo,
    redo,
    recordHistory,
    updateElement,
    updateChildWidget,
    updateChildrenBatch,
    updateElementsBatch,
  ]);


  function handleCreatePlane(name: string, width: number, height: number) {
    createPlane(name, width, height);
    setShowNewDialog(false);
    setView('editor');
  }

  function handleSave() {
    setSaveStatus('ok');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }

  const subcanvasEdit = editingGroup ? computeSubcanvasEditPlane(editingGroup) : null;
  const groupPreviewVariables = useMemo(
    () => (editingGroup ? buildGroupIndexPreviewVariables(editingGroup) : {}),
    [editingGroup?.id, editingGroup?.variableName, editingGroup?.groupVariableMode, editingGroup?.iteratorField],
  );

  const recordPropertyHistory = useCallback(() => {
    if (propertyHistoryRecordedRef.current) return;
    recordHistory();
    propertyHistoryRecordedRef.current = true;
  }, [recordHistory]);

  const resolveCanvasId = useCallback(
    (canvasId: string) => {
      if (!editingGroup) return canvasId;
      if (
        canvasId === TEMPLATE_CANVAS_LEGACY
        || canvasId === TEMPLATE_CANVAS_DEFAULT
        || canvasId === TEMPLATE_CANVAS_NORMAL
      ) {
        return editingGroupId!;
      }
      return canvasId;
    },
    [editingGroup, editingGroupId],
  );

  const formatPainterApi = useMemo(
    () => ({
      armed: formatPainter,
      arm: armFormatPainter,
      cancel: cancelFormatPainter,
      canApplyTo: (widget: ChildWidget) =>
        formatPainter ? canApplyWidgetFormat(formatPainter, widget) : false,
      apply: (canvasId: string, widget: ChildWidget) =>
        applyFormatPainter(resolveCanvasId(canvasId), widget),
    }),
    [formatPainter, armFormatPainter, cancelFormatPainter, applyFormatPainter, resolveCanvasId],
  );

  // ─── 列表視圖 ───
  if (view === 'list') {
    return (
      <div className="flex flex-col w-full h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        <header className="flex items-center gap-3 px-6 h-14 bg-zinc-900 border-b border-zinc-800 shrink-0 z-20">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <div className="flex items-center gap-2.5 text-cyan-400 font-bold text-lg">
            <LayoutGrid size={20} />
            <span>SyncDrive Dashboard</span>
          </div>
          <div className="flex-1" />
          <button onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
            <Settings size={20} />
          </button>
        </header>

        <DashboardList 
          planes={planes} 
          onSelect={(id) => { 
            setActivePlaneId(id); 
            selectElement(null);
            setIsEditMode(false);
            setView('editor'); 
          }}
          onCreate={() => setShowNewDialog(true)}
          onDelete={deletePlane}
          onImportTemplate={(result) => {
            importPlane(result.plane);
            const msg = [
              `已匯入平面「${result.plane.name}」`,
              ...result.dataSourceWarnings,
              result.bindingIssueCount > 0
                ? `⚠ ${result.bindingIssueCount} 處元件可能無法連線（畫布上會顯示驚嘆號）`
                : '',
            ].filter(Boolean).join('\n');
            alert(msg);
            setView('editor');
          }}
        />

        {showNewDialog && (
          <NewPlaneDialog onConfirm={handleCreatePlane} onCancel={() => setShowNewDialog(false)} />
        )}
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} onClearAll={clearAllData} />
        )}
      </div>
    );
  }

  const dualSubcanvas = editingGroup?.dualCanvasEnabled
    ? computeDualSubcanvasEditPlane(editingGroup)
    : null;

  const dualGatePanel = editingGroup?.dualCanvasEnabled
    && dualEditFocusId === TEMPLATE_GATE_SETTINGS
    && !panelSelectedChild;

  /** 未選子元件時顯示範本尺寸（templateWidth×Height），避免露出群組在大平面上的 3776×168 */
  const panelSelectedElement: CanvasElementProps | null = editingGroup
    ? panelSelectedChild
      ? null
      : dualGatePanel
        ? {
            ...editingGroup,
            width: editingGroup.templateWidth || 300,
            height: editingGroup.templateHeight || 200,
            label: `${editingGroup.label} · 雙畫板設定`,
          }
        : {
            ...editingGroup,
            width: dualSubcanvas?.designW ?? (editingGroup.templateWidth || 300),
            height: dualSubcanvas?.designH ?? (editingGroup.templateHeight || 200),
            label: dualEditFocusId === TEMPLATE_CANVAS_DEFAULT
              ? `${editingGroup.label} · 預設資料`
              : dualEditFocusId === TEMPLATE_CANVAS_NORMAL
                ? `${editingGroup.label} · 常態資料`
                : `${editingGroup.label} · 範本`,
          }
    : selectedElement;

  let displayPlane = activePlane;
  let displaySelectedElementId = selectedElementId;

  if (editingGroup && subcanvasEdit && dualSubcanvas) {
    const { editW, editH, laneW, laneH, gapW } = dualSubcanvas;
    displayPlane = {
      id: 'template-plane-dual',
      name: `編輯雙畫板: ${editingGroup.label}`,
      width: editW,
      height: editH,
      elements: [
        {
          ...editingGroup,
          id: TEMPLATE_CANVAS_DEFAULT,
          x: 0,
          y: 0,
          width: laneW,
          height: laneH,
          isGroup: false,
          opacity: 100,
          label: '預設資料',
          children: getDefaultChildren(editingGroup),
        },
        {
          ...editingGroup,
          id: TEMPLATE_CANVAS_NORMAL,
          x: laneW + gapW,
          y: 0,
          width: laneW,
          height: laneH,
          isGroup: false,
          opacity: 100,
          label: '常態資料',
          children: getNormalChildren(editingGroup),
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    displaySelectedElementId = dualEditFocusId;
  } else if (editingGroup && subcanvasEdit) {
    const { editW, editH } = subcanvasEdit;
    displayPlane = {
      id: 'template-plane',
      name: `編輯群組範本: ${editingGroup.label}`,
      width: editW,
      height: editH,
      elements: [{
        ...editingGroup,
        id: TEMPLATE_CANVAS_LEGACY,
        x: 0,
        y: 0,
        width: editW,
        height: editH,
        isGroup: false,
        opacity: 100,
        label: `${editingGroup.label} · 範本`,
        children: getNormalChildren(editingGroup),
      }],
      createdAt: 0,
      updatedAt: 0,
    };
    displaySelectedElementId = dualEditFocusId;
  }

  const handleUpdateElement = (id: string, patch: Partial<CanvasElementProps>, opts?: { fromCanvas?: boolean }) => {
    if (!opts?.fromCanvas) recordPropertyHistory();
    if (
      editingGroup
      && (id === TEMPLATE_CANVAS_LEGACY || id === TEMPLATE_CANVAS_DEFAULT || id === TEMPLATE_CANVAS_NORMAL)
    ) {
      // 子畫布編輯平面固定為大工作區；執行範本尺寸僅能從屬性面板調整
      const { x: _x, y: _y, width: _w, height: _h, ...rest } = patch;
      updateElement(editingGroupId!, rest);
    } else {
      updateElement(id, patch);
    }
  };

  const handleDeleteElement = (id: string) => {
    if (
      editingGroup
      && (id === TEMPLATE_CANVAS_LEGACY || id === TEMPLATE_CANVAS_DEFAULT || id === TEMPLATE_CANVAS_NORMAL)
    ) return;
    deleteElement(id);
  };

  const handleAddChild = (canvasId: string, widgetType: WidgetType, x: number, y: number) => {
    const lane = editingGroup?.dualCanvasEnabled
      ? laneFromTemplateCanvasId(canvasId)
      : null;
    if (lane === 'gate') return;
    const childId = addChildWidget(
      editingGroup ? editingGroupId! : canvasId,
      widgetType,
      x,
      y,
      lane === 'default' || lane === 'normal' ? lane : activeDualLane(),
    );
    return childId;
  };

  const handleUpdateChild = (canvasId: string, childId: string, patch: Partial<ChildWidget>, opts?: { fromCanvas?: boolean }) => {
    if (!opts?.fromCanvas) {
      recordPropertyHistory();
      notifyCloseCanvasChildList(editingGroup ? editingGroupId! : canvasId);
    }
    const lane = editingGroup?.dualCanvasEnabled
      ? laneFromTemplateCanvasId(canvasId)
      : null;
    updateChildWidget(
      editingGroup ? editingGroupId! : canvasId,
      childId,
      patch,
      lane === 'default' || lane === 'normal' ? lane : activeDualLane(),
    );
  };

  const handleDeleteChild = (canvasId: string, childId: string) => {
    const lane = editingGroup?.dualCanvasEnabled
      ? laneFromTemplateCanvasId(canvasId)
      : null;
    deleteChildWidget(
      editingGroup ? editingGroupId! : canvasId,
      childId,
      lane === 'default' || lane === 'normal' ? lane : activeDualLane(),
    );
  };

  // ─── 編輯器視圖 ───
  return (
    <DemoSimulationProvider>
    <VehicleFleetMqttProvider>
    <BindingHealthProvider
      plane={activePlane ?? displayPlane}
      enabled={!!activePlane && !editingGroup}
    >
    <FormatPainterProvider value={formatPainterApi}>
    <div className="flex flex-col w-full h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* ── 頂部工具列（載具內嵌編輯時由 VehicleEditorEmbed 自帶單一工具列） ── */}
      {!editingVehicleContainer && (
      <header className="flex items-center gap-3 px-4 h-12 bg-zinc-900 border-b border-zinc-800 shrink-0 z-20">
        
        {editingGroup ? (
          <>
            <button
              type="button"
              onClick={saveAndExitGroupEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-all"
            >
              <ArrowLeft size={16} /> 儲存並退出
            </button>
            <button
              type="button"
              onClick={() => setShowGroupExitDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-600 bg-zinc-800/80
                         text-zinc-300 text-xs font-semibold hover:border-zinc-500 hover:text-zinc-100 transition-all"
            >
              不儲存退出
            </button>
            <div className="text-sm font-bold text-cyan-400 truncate max-w-[200px]">
              子畫布：{editingGroup.label}
            </div>
            <div className="ml-2 flex items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/80 p-0.5">
              <button
                type="button"
                disabled={!canUndo}
                onClick={undo}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="復原 (⌘/Ctrl+Z)"
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={redo}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="重做 (⌘/Ctrl+Shift+Z 或 Ctrl+Y)"
              >
                <Redo2 size={14} />
              </button>
            </div>
          </>
        ) : (
          <>
            <button 
              onClick={() => setView('list')}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-cyan-400 transition-all mr-2"
              title="返回列表"
            >
              <ArrowLeft size={16} />
              <span className="text-xs font-bold uppercase">列表</span>
            </button>

            <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-sm pr-3 border-r border-zinc-700">
              <LayoutGrid size={15} />
              <span>Editor</span>
            </div>

            {/* 平面名稱編輯器 */}
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 focus-within:border-cyan-500/50 transition-all">
              <Monitor size={14} className="text-zinc-500" />
              <input
                value={activePlane?.name ?? ''}
                onChange={(e) => activePlane && updatePlane(activePlane.id, { name: e.target.value })}
                className="bg-transparent border-none outline-none text-sm font-bold text-zinc-100 w-[200px] placeholder:text-zinc-600"
                placeholder="未命名平面"
              />
            </div>

            <div className="flex-1" />

            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                isEditMode
                  ? 'bg-cyan-950/80 text-cyan-300 ring-1 ring-cyan-700/60'
                  : 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600'
              }`}
            >
              {isEditMode ? '編輯' : '檢視'}
            </span>

            {isEditMode ? (
              <button
                type="button"
                onClick={toggleEditMode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-sm transition hover:bg-zinc-700"
                title="離開編輯模式 (E)"
              >
                <LogOut size={14} />
                <span>離開編輯</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleEditMode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-3 py-1.5 text-xs font-medium text-cyan-200 shadow-sm transition hover:bg-cyan-900/50"
                title="進入編輯模式 (E)"
              >
                <Pencil size={14} />
                <span>編輯</span>
              </button>
            )}

            {isEditMode && (
              <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/80 p-0.5">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={undo}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                  title="復原 (⌘/Ctrl+Z)"
                >
                  <Undo2 size={14} />
                  <span className="hidden sm:inline">復原</span>
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={redo}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                  title="重做 (⌘/Ctrl+Shift+Z 或 Ctrl+Y)"
                >
                  <Redo2 size={14} />
                  <span className="hidden sm:inline">重做</span>
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex-1" />

        {activePlane && !editingGroup && !editingVehicleContainer && (
          <>
            <ImportTemplateButton
              variant="button"
              onImported={(result) => {
                importPlane(result.plane);
                setActivePlaneId(result.plane.id);
                const msg = [
                  `已匯入「${result.plane.name}」`,
                  ...result.dataSourceWarnings,
                ].join('\n');
                if (result.dataSourceWarnings.length) alert(msg);
              }}
            />
            <ExportTemplateButton plane={activePlane} />
            <BindingIssuesBar />
          </>
        )}


        {/* Settings */}
        <button onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700
                     text-zinc-400 text-xs hover:border-purple-600 hover:text-purple-400 transition-colors">
          <Settings size={13} /> 資料來源
        </button>

        {/* 剪貼簿狀態提示 */}
        {clipboard && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-900/20 border border-amber-700/40 text-amber-400 text-xs">
            <Copy size={11} />
            <span className="font-mono text-[10px]">
              已複製 {clipboard.kind === 'canvas' ? '畫布' : '元件'}
            </span>
          </div>
        )}
        {formatPainter && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fuchsia-900/30 border border-fuchsia-600/50 text-fuchsia-200 text-xs animate-pulse">
            <Paintbrush size={11} />
            <span className="font-mono text-[10px]">
              格式刷：點選同類型元件（{formatPainter.sourceType}）· Esc 取消
            </span>
          </div>
        )}
        <button
          id="save-btn"
          onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all duration-200"
          style={{
            background: saveStatus === 'ok' ? 'rgba(16,185,129,0.1)' : saveStatus === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(39,39,42,1)',
            borderColor: saveStatus === 'ok' ? '#10b981' : saveStatus === 'error' ? '#ef4444' : '#52525b',
            color: saveStatus === 'ok' ? '#10b981' : saveStatus === 'error' ? '#ef4444' : '#d4d4d8',
          }}
        >
          <Save size={13} />
          {saveStatus === 'ok' ? '✓ 已儲存' : saveStatus === 'error' ? '❌ 儲存失敗' : '儲存'}
        </button>

        {(editingGroup && dualSubcanvas ? (
          <div className="text-zinc-600 text-[10px] font-mono pl-2 border-l border-zinc-700">
            雙畫板 {dualSubcanvas.laneW}×{dualSubcanvas.laneH}
            <span className="text-zinc-700 mx-1">·</span>
            範本 {dualSubcanvas.designW}×{dualSubcanvas.designH}
          </div>
        ) : editingGroup && subcanvasEdit ? (
          <div className="text-zinc-600 text-[10px] font-mono pl-2 border-l border-zinc-700">
            編輯區 {subcanvasEdit.editW}×{subcanvasEdit.editH}
            <span className="text-zinc-700 mx-1">·</span>
            執行範本 {subcanvasEdit.designW}×{subcanvasEdit.designH}
          </div>
        ) : activePlane ? (
          <div className="text-zinc-600 text-[10px] font-mono pl-2 border-l border-zinc-700">
            {activePlane.width} × {activePlane.height}
          </div>
        ) : null)}
      </header>
      )}

      {/* ── 主要內容 ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <VariableProvider variables={editingGroup ? groupPreviewVariables : {}}>
        {editingVehicleContainer && editingVehicleContainerWidget ? (
          <div className="flex min-h-0 flex-1">
            <VehicleEditorEmbed
              vehicleId={editingVehicleContainerWidget.vehicleDefinitionId}
              startInEditMode
              embedded={{
                containerLabel: editingVehicleContainerWidget.label,
                onExit: exitEditVehicleContainer,
              }}
              onVehicleIdChange={(id) => {
                updateChildWidget(
                  editingVehicleContainer.canvasId,
                  editingVehicleContainer.childId,
                  { vehicleDefinitionId: id },
                );
              }}
            />
          </div>
        ) : displayPlane ? (
          <PlaneWorkspace
            key={editingGroupId ?? `plane-${activePlane?.id ?? 'main'}-${view}`}
            plane={displayPlane}
            subcanvasDesignBounds={
              dualSubcanvas
                ? undefined
                : subcanvasEdit
                  ? { width: subcanvasEdit.designW, height: subcanvasEdit.designH }
                  : undefined
            }
            dualCanvasEdit={dualSubcanvas ? {
              laneW: dualSubcanvas.laneW,
              laneH: dualSubcanvas.laneH,
              gapW: dualSubcanvas.gapW,
              designW: dualSubcanvas.designW,
              designH: dualSubcanvas.designH,
              gateSelected: dualEditFocusId === TEMPLATE_GATE_SETTINGS,
              onSelectGate: () => {
                setDualEditFocusId(TEMPLATE_GATE_SETTINGS);
                selectElement(editingGroupId!);
              },
            } : undefined}
            selectedElementId={displaySelectedElementId}
            selectedElementIds={editingGroup && displaySelectedElementId
              ? [displaySelectedElementId]
              : selectedElementIds}
            selectedChildId={selectedChildId}
            selectedChildIds={activeSelectedChildIds}
            isEditMode={isEditMode || !!editingGroup} // 強制進入編輯模式
            onSelectElement={(id, opts) => {
              if (editingGroup?.dualCanvasEnabled) {
                if (id) setDualEditFocusId(id);
                selectElement(editingGroupId!);
                return;
              }
              if (editingGroup) selectElement(editingGroupId!);
              else selectElement(id, opts);
            }}
            onSelectElements={(ids, opts) => {
              if (editingGroup) {
                if (ids.length > 0) setDualEditFocusId(ids[0]);
                selectElement(editingGroupId!);
                return;
              }
              selectElements(ids, opts);
            }}
            onSelectChild={(canvasId, childId, opts) => {
              if (editingGroup?.dualCanvasEnabled) setDualEditFocusId(canvasId);
              if (editingGroup) selectChild(editingGroupId!, childId, opts);
              else selectChild(canvasId, childId, opts);
            }}
            onSelectChildren={(canvasId, childIds, opts) => {
              if (editingGroup?.dualCanvasEnabled) setDualEditFocusId(canvasId);
              if (editingGroup) selectChildren(editingGroupId!, childIds, opts);
              else selectChildren(canvasId, childIds, opts);
            }}
            onUpdateElement={(id, patch) => handleUpdateElement(id, patch, { fromCanvas: true })}
            onBatchUpdateElements={(updates) => {
              recordHistory();
              updateElementsBatch(updates);
            }}
            onDeleteElement={handleDeleteElement}
            onAddChild={handleAddChild}
            onUpdateChild={(canvasId, childId, patch) =>
              handleUpdateChild(canvasId, childId, patch, { fromCanvas: true })
            }
            onBatchUpdateChildren={(canvasId, updates) => {
              recordHistory();
              const lane = editingGroup?.dualCanvasEnabled
                ? laneFromTemplateCanvasId(canvasId)
                : null;
              updateChildrenBatch(
                editingGroup ? editingGroupId! : canvasId,
                updates,
                lane === 'default' || lane === 'normal' ? lane : activeDualLane(),
              );
            }}
            onDeleteChild={handleDeleteChild}
            onAddCanvas={(isGroup, x, y, canvasKind) => addCanvasElement(isGroup, x, y, canvasKind)}
            onEnterEditGroupMode={enterEditGroupMode}
            onEditSessionStart={recordHistory}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Monitor size={48} className="text-zinc-700" />
            <p className="text-zinc-500 text-sm">尚無平面，請點擊「新增平面」開始設計</p>
            <button onClick={() => setShowNewDialog(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 text-white text-sm hover:bg-cyan-500 transition-colors">
              <Plus size={16} /> 新增第一個平面
            </button>
          </div>
        )}

        {/* 屬性面板（載具內嵌編輯時由 VehicleEditorEmbed 自帶） */}
        {!editingVehicleContainer && (
        <PropertiesPanel
          isEditMode={isEditMode || !!editingGroup}
          activePlane={activePlane}
          editingGroupLabel={editingGroup?.label}
          editingGroup={editingGroup}
          dualGateSettingsActive={dualGatePanel}
          selectedElement={panelSelectedElement}
          selectedChild={editingGroup ? panelSelectedChild : selectedChild}
          selectedChildCount={activeSelectedChildIds.length}
          onUpdatePlane={(patch) => activePlane && updatePlane(activePlane.id, patch)}
          onDeletePlane={() => activePlane && deletePlane(activePlane.id)}
          onUpdateElement={(patch) => {
            recordPropertyHistory();
            if (editingGroup) {
              const { x: _x, y: _y, width, height, ...rest } = patch;
              const groupPatch: Partial<CanvasElementProps> = { ...rest };
              if (width !== undefined) groupPatch.templateWidth = width;
              if (height !== undefined) groupPatch.templateHeight = height;
              updateElement(editingGroupId!, groupPatch);
            } else if (selectedElement) {
              updateElement(selectedElement.id, patch);
            }
          }}
          onDeleteElement={() => {
            if (!editingGroup && selectedElement) deleteElement(selectedElement.id);
          }}
          onUpdateChild={(patch) => {
            recordPropertyHistory();
            if (editingGroup && panelSelectedChild) {
              notifyCloseCanvasChildList(editingGroupId!);
              updateChildWidget(
                editingGroupId!,
                panelSelectedChild.id,
                patch,
                activeDualLane(),
              );
            } else if (selectedElement && selectedChild) {
              notifyCloseCanvasChildList(selectedElement.id);
              updateChildWidget(selectedElement.id, selectedChild.id, patch);
            }
          }}
          onDeleteChild={() => {
            if (editingGroup && panelSelectedChild) {
              deleteChildWidget(editingGroupId!, panelSelectedChild.id, activeDualLane());
            } else if (selectedElement && selectedChild) {
              deleteChildWidget(selectedElement.id, selectedChild.id);
            }
          }}
          onEnterEditGroupMode={enterEditGroupMode}
          onEnterEditVehicleContainer={() => {
            if (selectedElement && selectedChild?.type === 'vehicle-container') {
              enterEditVehicleContainer(selectedElement.id, selectedChild.id);
            }
          }}
        />
        )}
        </VariableProvider>
      </div>

      {/* ── 底部元件工具欄 ── */}
      {!editingVehicleContainer && (
      <ComponentPalette 
        isEditMode={isEditMode || !!editingGroup}
        hasActiveCanvas={!!displayPlane && !!displaySelectedElementId}
        hasActivePlane={!!displayPlane}
        activeCanvasKind={selectedElement?.canvasKind}
        activeCanvasIsGroup={selectedElement?.isGroup}
        onAddCanvas={addCanvasElement}
      />
      )}

      {/* Dialog */}
      {showNewDialog && (
        <NewPlaneDialog onConfirm={handleCreatePlane} onCancel={() => setShowNewDialog(false)} />
      )}

      {/* 設定 Modal */}
      {showSettings && (
        <SettingsModal 
          onClose={() => setShowSettings(false)} 
          onClearAll={clearAllData}
        />
      )}

      {showGroupExitDialog && editingGroup && (
        <GroupTemplateExitDialog
          groupLabel={editingGroup.label}
          onCancel={() => setShowGroupExitDialog(false)}
          onDiscard={discardAndExitGroupEdit}
          onSave={saveAndExitGroupEdit}
        />
      )}
    </div>
    <SimulationTransportToolbar />
    </FormatPainterProvider>
    </BindingHealthProvider>
    </VehicleFleetMqttProvider>
    </DemoSimulationProvider>
  );
}
