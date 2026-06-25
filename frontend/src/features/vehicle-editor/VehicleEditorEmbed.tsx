import { useEffect, useRef } from 'react';
import { ArrowLeft, Download, Redo2, Undo2, Upload } from 'lucide-react';
import { VariableProvider } from '../dashboard/VariableContext';
import { ComponentPalette } from './ComponentPalette';
import { PropertiesPanel } from './PropertiesPanel';
import { VehicleWorkspace } from './VehicleWorkspace';
import { useVehicleEditor } from './useVehicleEditor';
import { VEHICLE_NUDGE_SHIFT_STEP, VEHICLE_NUDGE_STEP } from './utils/vehicleNudge';

function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 內嵌載具編輯器：無清單頁，直接進入編輯；資料與獨立載具編輯器共用 */
export function VehicleEditorEmbed({
  vehicleId,
  onVehicleIdChange,
  startInEditMode = true,
  embedded,
}: {
  vehicleId: string;
  onVehicleIdChange?: (id: string) => void;
  startInEditMode?: boolean;
  /** 儀表板載具容器內嵌：單一工具列、無預覽切換與重複儲存 */
  embedded?: {
    containerLabel?: string;
    onExit: () => void;
  };
}) {
  const {
    vehicles,
    activeVehicle,
    activeVehicleId,
    setActiveVehicleId,
    selectedElementId,
    selectedElementIds,
    selectedElement,
    selectElement,
    selectElements,
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

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const editMode = embedded ? true : startInEditMode;

  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [flushSave]);

  useEffect(() => {
    setActiveVehicleId(vehicleId);
    selectElement(null);
  }, [vehicleId, setActiveVehicleId, selectElement]);

  useEffect(() => {
    if (!editMode) return;

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
        e.stopPropagation();
        if (selectedElementIds.length > 1) {
          deleteSelectedElements(activeVehicleId);
        } else if (selectedElementId) {
          deleteElement(activeVehicleId, selectedElementId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    editMode,
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

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const addedIds = await importVehiclesFromFile(file);
      if (addedIds.length > 0) {
        const newId = addedIds[addedIds.length - 1]!;
        setActiveVehicleId(newId);
        onVehicleIdChange?.(newId);
      } else {
        window.alert('匯入失敗：檔案內沒有有效的載具定義（需含 id、name、elements）');
      }
    } catch {
      window.alert('匯入失敗：請確認檔案為載具編輯器匯出的 JSON（含 id、name、elements）');
    } finally {
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    }
  };

  if (!activeVehicle || activeVehicleId !== vehicleId) {
    const linked = vehicles.find((v) => v.id === vehicleId);
    if (!linked) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          找不到載具定義，請從屬性面板重新選擇或匯入 JSON
        </div>
      );
    }
  }

  const vehicle = activeVehicle ?? vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        載入載具中…
      </div>
    );
  }

  const vid = activeVehicleId ?? vehicleId;

  const toolbarBtnCls =
    'inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-35';

  const importExportInput = (
    <input
      ref={importFileInputRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => void handleImportFile(e.target.files?.[0])}
    />
  );

  const actionButtons = (
    <div className="ml-auto flex items-center gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        className={toolbarBtnCls}
        title="復原 (⌘Z)"
      >
        <Undo2 size={13} />
        復原
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        className={toolbarBtnCls}
        title="重做 (⌘⇧Z)"
      >
        <Redo2 size={13} />
        重做
      </button>
      <span className="mx-0.5 h-5 w-px bg-zinc-700" />
      <button
        type="button"
        onClick={() => importFileInputRef.current?.click()}
        className={toolbarBtnCls}
        title="匯入載具 JSON"
      >
        <Upload size={13} />
        匯入
      </button>
      <button
        type="button"
        onClick={() => exportVehiclesJson([vid])}
        className={toolbarBtnCls}
        title="匯出載具 JSON"
      >
        <Download size={13} />
        匯出
      </button>
      {importExportInput}
    </div>
  );

  return (
    <VariableProvider variables={{}}>
      <div className="flex h-full min-h-0 w-full flex-col bg-[#0a0f1a]">
        {embedded ? (
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4">
            <button
              type="button"
              onClick={() => {
                flushSave();
                embedded.onExit();
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
            >
              <ArrowLeft size={15} />
              完成
            </button>
            <div className="min-w-0 truncate text-xs text-zinc-400">
              <span className="font-semibold text-amber-400">
                {embedded.containerLabel?.trim() || '載具'}
              </span>
              <span className="mx-1.5 text-zinc-600">·</span>
              <span className="text-zinc-300">{vehicle.name}</span>
              <span className="ml-1.5 font-mono text-[10px] text-zinc-600">
                {vehicle.width}×{vehicle.height}
              </span>
            </div>
            {actionButtons}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <VehicleWorkspace
            vehicle={vehicle}
            selectedElementIds={selectedElementIds}
            isEditMode={editMode}
            onSelectElement={selectElement}
            onSelectElements={selectElements}
            onBeginEditSession={beginEditSession}
            onUpdateElement={(id, patch, options) => {
              updateElement(vid, id, patch, options);
            }}
            onBatchUpdateElements={(updates, options) => {
              batchUpdateElements(vid, updates, options);
            }}
            onResizeCanvas={(patch, options) => {
              updateVehicle(vid, { width: patch.width, height: patch.height }, options);
            }}
            onAddElement={(type, x, y) => addElement(vid, type, x, y)}
            onRotateLeft90={(id) => rotateElement(vid, id, -90)}
            onRotateRight90={(id) => rotateElement(vid, id, 90)}
            onRotateDelta={(id, delta) => rotateElement(vid, id, delta)}
          />
          <PropertiesPanel
            vehicle={vehicle}
            selectedElement={selectedElement}
            selectedCount={selectedElementIds.length}
            onUpdateVehicle={(patch) => updateVehicle(vid, patch)}
            onUpdateElement={(id, patch, options) => updateElement(vid, id, patch, options)}
            onDeleteElement={(id) => deleteElement(vid, id)}
          />
        </div>

        <ComponentPalette
          isEditMode={editMode}
          onAddAtCenter={(type) => {
            const x = Math.round(vehicle.width / 2 - 20);
            const y = Math.round(vehicle.height / 2 - 20);
            addElement(vid, type, x, y);
          }}
        />
      </div>
    </VariableProvider>
  );
}
