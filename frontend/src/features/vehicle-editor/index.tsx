import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bus, Copy, Download, Pencil, Redo2, Save, Undo2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VariableProvider } from '../dashboard/VariableContext';
import { ComponentPalette } from './ComponentPalette';
import { VehiclePreviewTestPanel } from './components/VehiclePreviewTestPanel';
import { NewVehicleDialog } from './NewVehicleDialog';
import { PropertiesPanel } from './PropertiesPanel';
import { VehicleList } from './VehicleList';
import { VehicleWorkspace } from './VehicleWorkspace';
import { useVehicleEditor } from './useVehicleEditor';
import { VehicleDefinitionConflictError, type VehicleModelReference } from './api/vehicleDefinitionsApi';
import type { VehicleDefinition } from './types';
import { VEHICLE_NUDGE_SHIFT_STEP, VEHICLE_NUDGE_STEP } from './utils/vehicleNudge';

function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 引用說明（刪除被擋下時列給使用者看） */
export function describeVehicleModelReference(ref: VehicleModelReference): string {
  if (ref.kind === 'default') return '系統預設模型';
  if (ref.kind === 'map') return `地圖 ${ref.mapId}`;
  return `儀表板「${ref.planeName}」${ref.label ? `的「${ref.label}」` : ''}`;
}

/**
 * 車輛模型管理（圖資管理 → 車輛模型）：模型清單、新增、編輯、複製、刪除、匯入匯出。
 * 編輯器本體、元件、素材、資料綁定、預覽與編輯歷史都是既有的 vehicle-editor。
 */
export default function VehicleEditor({
  renderUsage,
  onModelsChanged,
  initialVehicleId = null,
}: {
  renderUsage?: (vehicle: VehicleDefinition) => ReactNode;
  /** 清單變了（父層重抓引用與預設設定用） */
  onModelsChanged?: (models: VehicleDefinition[]) => void;
  /** 一進來就打開這個模型（從儀表板「前往圖資管理編輯」） */
  initialVehicleId?: string | null;
} = {}) {
  const { t } = useTranslation();
  const {
    vehicles,
    loadState,
    syncState,
    reloadFromServer,
    takeServerVersion,
    activeVehicle,
    activeVehicleId,
    setActiveVehicleId,
    selectedElementId,
    selectedElementIds,
    selectedElement,
    selectElement,
    selectElements,
    createVehicle,
    deleteVehicle,
    duplicateVehicle,
    exportVehiclesJson,
    importVehiclesFromFile,
    flushSave,
    updateVehicle,
    addElement,
    updateElement,
    batchUpdateElements,
    deleteElement,
    deleteSelectedElements,
    nudgeSelectedElements,
    rotateElement,
    beginEditSession,
    copySelectedElement,
    pasteElement,
    undo,
    redo,
    canUndo,
    canRedo,
    hasClipboard,
  } = useVehicleEditor();

  const hasClipboardRef = useRef(hasClipboard);
  hasClipboardRef.current = hasClipboard;

  const [view, setView] = useState<'list' | 'editor'>('list');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok'>('idle');
  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [listMessage, setListMessage] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const readOnly = loadState !== 'ready';
  const onModelsChangedRef = useRef(onModelsChanged);
  useEffect(() => {
    onModelsChangedRef.current = onModelsChanged;
  });
  const modelKey = vehicles.map((v) => `${v.id}:${v.serverVersion ?? ''}`).join('|');
  useEffect(() => {
    if (loadState === 'ready') onModelsChangedRef.current?.(vehicles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, loadState]);
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialVehicleId || loadState !== 'ready') return;
    openedInitial.current = true;
    if (vehicles.some((v) => v.id === initialVehicleId)) {
      setActiveVehicleId(initialVehicleId);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 後端清單讀到之後只開一次
      setView('editor');
    }
  }, [initialVehicleId, loadState, vehicles, setActiveVehicleId]);

  const handleDelete = async (id: string) => {
    setListMessage(null);
    try {
      await deleteVehicle(id);
    } catch (error) {
      if (error instanceof VehicleDefinitionConflictError && error.references?.length) {
        setListMessage(
          `${error.message}：${error.references.map(describeVehicleModelReference).join('、')}`,
        );
      } else {
        setListMessage(error instanceof Error ? error.message : '刪除失敗');
      }
    }
  };

  const toggleEditMode = useCallback(() => {
    setIsEditMode((v) => {
      if (v) selectElement(null);
      return !v;
    });
  }, [selectElement]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'e' || e.key === 'E') {
        if (view === 'editor' && !showNewDialog) toggleEditMode();
      }
      if (e.key === 'Escape' && isEditMode) {
        selectElement(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, showNewDialog, isEditMode, toggleEditMode, selectElement]);

  useEffect(() => {
    if (view !== 'editor' || !isEditMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        if (isTextEditingTarget(e.target)) return;
        if (selectedElementIds.length === 0) return;
        if (e.repeat) return;
        e.preventDefault();
        const step = e.shiftKey ? VEHICLE_NUDGE_SHIFT_STEP : VEHICLE_NUDGE_STEP;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelectedElements(dx, dy);
        return;
      }

      if (mod && e.key.toLowerCase() === 'a') {
        if (isTextEditingTarget(e.target)) return;
        if (!activeVehicle?.elements.length) return;
        e.preventDefault();
        selectElements(activeVehicle.elements.map((el) => el.id));
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        if (isTextEditingTarget(e.target)) return;
        if (!selectedElementId) return;
        e.preventDefault();
        copySelectedElement();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (isTextEditingTarget(e.target)) return;
        if (!hasClipboardRef.current()) return;
        e.preventDefault();
        pasteElement();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTextEditingTarget(e.target)) return;
        if (!activeVehicleId) return;
        e.preventDefault();
        if (selectedElementIds.length > 1) {
          deleteSelectedElements(activeVehicleId);
        } else if (selectedElementId) {
          deleteElement(activeVehicleId, selectedElementId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    view,
    isEditMode,
    selectedElementId,
    selectedElementIds,
    activeVehicleId,
    activeVehicle,
    selectElements,
    undo,
    redo,
    copySelectedElement,
    pasteElement,
    deleteElement,
    deleteSelectedElements,
    nudgeSelectedElements,
  ]);

  const handleSelectVehicle = (id: string) => {
    setActiveVehicleId(id);
    setView('editor');
    setIsEditMode(false);
    selectElement(null);
  };

  const handleCreate = (name: string, width: number, height: number) => {
    createVehicle(name, width, height);
    setShowNewDialog(false);
    setView('editor');
    setIsEditMode(true);
    setSaveStatus('ok');
    setTimeout(() => setSaveStatus('idle'), 1500);
  };

  const handleSaveFeedback = () => {
    flushSave();
    setSaveStatus('ok');
    setTimeout(() => setSaveStatus('idle'), 1500);
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const addedIds = await importVehiclesFromFile(file);
      setImportStatus(addedIds.length > 0 ? 'ok' : 'error');
    } catch {
      setImportStatus('error');
    } finally {
      if (importFileInputRef.current) importFileInputRef.current.value = '';
      window.setTimeout(() => setImportStatus('idle'), 2000);
    }
  };

  const handleUpdatePreviewData = useCallback(
    (previewData: Record<string, unknown>) => {
      if (activeVehicleId) updateVehicle(activeVehicleId, { previewData });
    },
    [activeVehicleId, updateVehicle],
  );

  if (view === 'list') {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-[#0a0f1a]">
        <VehicleList
          vehicles={vehicles}
          readOnly={readOnly}
          renderUsage={renderUsage}
          banner={
            loadState !== 'ready' || listMessage ? (
              <div
                role="status"
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                  listMessage || loadState === 'offline'
                    ? 'border-red-500/40 bg-red-500/10 text-red-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                }`}
              >
                <span>
                  {listMessage ??
                    (loadState === 'loading'
                      ? '讀取後端模型中…（讀到之前不能修改）'
                      : '連不上後端：只顯示此瀏覽器的快取，不能修改')}
                </span>
                {loadState === 'offline' ? (
                  <button type="button" className="underline" onClick={() => void reloadFromServer()}>
                    重試
                  </button>
                ) : listMessage ? (
                  <button type="button" onClick={() => setListMessage(null)}>
                    關閉
                  </button>
                ) : null}
              </div>
            ) : null
          }
          onSelect={handleSelectVehicle}
          onCreate={() => setShowNewDialog(true)}
          onDelete={handleDelete}
          onDuplicate={duplicateVehicle}
          onExportOne={(id) => exportVehiclesJson([id])}
          onExportAll={() => exportVehiclesJson()}
          onImportFile={async (file) => (await importVehiclesFromFile(file)).length}
        />
        {showNewDialog && (
          <NewVehicleDialog
            onConfirm={handleCreate}
            onCancel={() => setShowNewDialog(false)}
          />
        )}
      </div>
    );
  }

  if (!activeVehicle) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        {t('vehicleEditor.editor.notFound')}
      </div>
    );
  }

  return (
    <VariableProvider variables={{}}>
      <div className="flex h-full min-h-0 w-full flex-col bg-[#0a0f1a]">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              flushSave();
              setView('list');
              setIsEditMode(false);
              selectElement(null);
            }}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <ArrowLeft size={14} />
            {t('vehicleEditor.editor.backToList')}
          </button>
          <div className="flex items-center gap-2 border-l border-zinc-800 pl-3">
            <Bus size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-zinc-200">{activeVehicle.name}</span>
            <span className="font-mono text-[10px] text-zinc-600">
              {activeVehicle.width}×{activeVehicle.height}
            </span>
          </div>
          <SyncBadge
            state={syncState[activeVehicle.id]}
            unsaved={activeVehicle.serverVersion === undefined}
            onTakeServer={() => takeServerVersion(activeVehicle.id)}
          />
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              title={t('vehicleEditor.editor.duplicateTitle')}
              onClick={() => {
                if (activeVehicleId) duplicateVehicle(activeVehicleId);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              <Copy size={14} />
              {t('common.duplicate')}
            </button>
            <button
              type="button"
              title={t('vehicleEditor.editor.exportTitle')}
              onClick={() => {
                if (activeVehicleId) exportVehiclesJson([activeVehicleId]);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              <Download size={14} />
              {t('vehicleEditor.editor.export')}
            </button>
            <button
              type="button"
              title={t('vehicleEditor.editor.importTitle')}
              onClick={() => importFileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              <Upload size={14} />
              {importStatus === 'ok'
                ? t('vehicleEditor.editor.importOk')
                : importStatus === 'error'
                  ? t('vehicleEditor.editor.importFail')
                  : t('vehicleEditor.editor.import')}
            </button>
            <input
              ref={importFileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleImportFile(e.target.files?.[0])}
            />
            {isEditMode && (
              <>
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  title={t('vehicleEditor.editor.undoTitle')}
                  className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:border-zinc-500 hover:text-white disabled:opacity-30"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  title={t('vehicleEditor.editor.redoTitle')}
                  className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:border-zinc-500 hover:text-white disabled:opacity-30"
                >
                  <Redo2 size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              disabled={readOnly || syncState[activeVehicle.id]?.status === 'conflict'}
              title={readOnly ? '後端模型還沒讀到，不能修改' : undefined}
              onClick={toggleEditMode}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isEditMode
                  ? 'bg-amber-600 text-white'
                  : 'border border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              <Pencil size={14} />
              {isEditMode ? t('vehicleEditor.editor.editing') : t('vehicleEditor.editor.edit')}
            </button>
            <button
              type="button"
              onClick={handleSaveFeedback}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              <Save size={14} />
              {saveStatus === 'ok' ? t('vehicleEditor.editor.autoSaved') : t('vehicleEditor.editor.save')}
            </button>
          </div>
        </header>

          <div className="flex min-h-0 flex-1">
            <VehicleWorkspace
              vehicle={activeVehicle}
              selectedElementIds={selectedElementIds}
              isEditMode={isEditMode}
              onSelectElement={selectElement}
              onSelectElements={selectElements}
              onBeginEditSession={beginEditSession}
              onUpdateElement={(id, patch, options) => {
                if (activeVehicleId) updateElement(activeVehicleId, id, patch, options);
              }}
              onBatchUpdateElements={(updates, options) => {
                if (activeVehicleId) batchUpdateElements(activeVehicleId, updates, options);
              }}
              onResizeCanvas={(patch, options) => {
                if (!activeVehicleId) return;
                updateVehicle(
                  activeVehicleId,
                  { width: patch.width, height: patch.height },
                  options,
                );
              }}
              onAddElement={(type, x, y) => {
                if (activeVehicleId) addElement(activeVehicleId, type, x, y);
              }}
              onRotateLeft90={(id) => {
                if (activeVehicleId) rotateElement(activeVehicleId, id, -90);
              }}
              onRotateRight90={(id) => {
                if (activeVehicleId) rotateElement(activeVehicleId, id, 90);
              }}
              onRotateDelta={(id, delta) => {
                if (activeVehicleId) rotateElement(activeVehicleId, id, delta);
              }}
            />
            <PropertiesPanel
              vehicle={activeVehicle}
              selectedElement={selectedElement}
              selectedCount={selectedElementIds.length}
              onUpdateVehicle={(patch) => {
                if (activeVehicleId) updateVehicle(activeVehicleId, patch);
              }}
              onUpdateElement={(id, patch, options) => {
                if (activeVehicleId) updateElement(activeVehicleId, id, patch, options);
              }}
              onDeleteElement={(id) => {
                if (activeVehicleId) deleteElement(activeVehicleId, id);
              }}
            />
          </div>

          <ComponentPalette
            isEditMode={isEditMode}
            onAddAtCenter={(type) => {
              if (!activeVehicleId || !activeVehicle) return;
              const x = Math.round(activeVehicle.width / 2 - 20);
              const y = Math.round(activeVehicle.height / 2 - 20);
              addElement(activeVehicleId, type, x, y);
            }}
          />
          {!isEditMode && (
            <VehiclePreviewTestPanel
              vehicle={activeVehicle}
              onUpdatePreviewData={handleUpdatePreviewData}
            />
          )}
        </div>
      </VariableProvider>
  );
}

function SyncBadge({
  state,
  unsaved,
  onTakeServer,
}: {
  state: ReturnType<typeof useVehicleEditor>['syncState'][string] | undefined;
  unsaved: boolean;
  onTakeServer: () => void;
}) {
  if (state?.status === 'conflict') {
    return (
      <span className="flex items-center gap-2 rounded-md bg-red-500/15 px-2 py-1 text-[11px] text-red-200">
        {state.message}
        <button type="button" className="underline" onClick={onTakeServer}>
          {state.current ? '改用伺服器版本' : '移除本機副本'}
        </button>
      </span>
    );
  }
  if (state?.status === 'error')
    return <span className="rounded-md bg-red-500/15 px-2 py-1 text-[11px] text-red-200">未存到後端：{state.message}</span>;
  if (state?.status === 'saving') return <span className="text-[11px] text-zinc-500">儲存中…</span>;
  if (state?.status === 'saved') return <span className="text-[11px] text-emerald-400">已存到後端</span>;
  if (unsaved) return <span className="text-[11px] text-amber-300">尚未存到後端</span>;
  return null;
}
