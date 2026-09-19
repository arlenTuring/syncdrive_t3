import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CanvasElementProps } from '../types';
import { useWidgetData } from './useWidgetData';
import { resolveBuiltinGroupSql } from '../utils/resolveBuiltinGroupSql';
import { VariableProvider } from '../VariableContext';
import { WidgetRenderer } from './WidgetRenderer';
import { computeGroupTileLayout, getTemplateDesignSize, getTemplateUniformScale } from './groupTileLayout';
import { EditModeProvider } from '../context/EditModeContext';
import { assignStickyPoolSlots } from '../utils/groupSlotPool';
import {
  getNormalChildren,
  isDualCanvasGroup,
  shouldShowNormalPanel,
} from '../utils/dualCanvas';
import { DualCanvasDefaultView } from './DualCanvasDefaultView';
import { buildTemplatePreviewRow } from '../utils/groupTemplateContext';
import { useOperationMqttShiftOverlay } from '../hooks/useOperationMqttShiftOverlay';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import {
  mergeMainlineShiftRoster,
  mergeMaintenanceShiftRoster,
} from '../utils/mergeShiftRosterRows';
import { Edit3, Variable } from 'lucide-react';

function isShiftRosterGroup(label: string | undefined): boolean {
  return label === '正線班次' || label === '整備班表';
}

interface Props {
  element: CanvasElementProps;
  isEditMode: boolean;
  isCanvasSelected?: boolean;
  onEnterEditMode: () => void;
}

function buildVariables(
  element: CanvasElementProps,
  row: Record<string, unknown> | null,
  index: number,
  isEditMode: boolean,
) {
  const previewRow = isEditMode && row === null ? buildTemplatePreviewRow(index) : null;
  const effectiveRow = row ?? previewRow;
  const varName = element.variableName || 'item';
  const indexMode = (element.groupVariableMode ?? 'row') === 'index';
  const varValue = indexMode
    ? index
    : row
      ? (element.iteratorField ? row[element.iteratorField] : index)
      : previewRow?.[element.iteratorField || varName] ?? index;
  const variables: Record<string, unknown> = { [varName]: varValue };
  if (!indexMode && effectiveRow) {
    Object.entries(effectiveRow).forEach(([k, v]) => { variables[k] = v; });
  }
  return variables;
}

function SlotTransitionBox({
  children,
  className = '',
  style,
  animKey,
  transition = 'flip',
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  animKey?: string;
  transition?: 'none' | 'fade' | 'flip';
}) {
  const flipMs = 520;
  const skipAnim = transition === 'none' || animKey === undefined;
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [shown, setShown] = useState<{ key?: string; node: ReactNode }>({ key: animKey, node: children });
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useEffect(() => {
    if (skipAnim) return;
    if (animKey === shown.key) return;
    setPhase('out');
    const t = window.setTimeout(() => {
      setShown({ key: animKey, node: childrenRef.current });
      setPhase('in');
    }, transition === 'flip' ? flipMs * 0.42 : 50);
    return () => clearTimeout(t);
  }, [skipAnim, animKey, shown.key, transition]);

  if (skipAnim) {
    return <div className={className} style={style}>{children}</div>;
  }

  // 同一張卡直接用本次 render 的內容，ETA／狀態才會隨 MQTT 更新。
  // 只有 animKey 改變的退場階段需要暫存上一張卡。
  const visibleNode = animKey === shown.key ? children : shown.node;

  if (transition === 'fade') {
    return (
      <div
        className={className}
        style={{
          ...style,
          opacity: phase === 'in' ? 1 : 0,
          transform: phase === 'in' ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 0.45s ease, transform 0.45s ease',
        }}
      >
        {visibleNode}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        ...style,
        perspective: 520,
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transformOrigin: 'center bottom',
          transform: phase === 'in' ? 'rotateX(0deg)' : 'rotateX(-88deg)',
          opacity: 1,
          transition: `transform ${flipMs}ms cubic-bezier(0.22, 0.9, 0.28, 1)`,
          backfaceVisibility: 'hidden',
        }}
      >
        {visibleNode}
      </div>
    </div>
  );
}

function TemplateInstance({
  element,
  row,
  index,
  style,
  animKey,
  isEditMode,
  slotTransition = 'flip',
}: {
  element: CanvasElementProps;
  row: Record<string, unknown> | null;
  index: number;
  style?: CSSProperties;
  animKey?: string;
  isEditMode: boolean;
  slotTransition?: 'none' | 'fade' | 'flip';
}) {
  const isPreviewMode = row === null;
  const hideChrome = !!element.templateHideChrome && !isPreviewMode;
  const varName = element.variableName || 'item';
  const rowFingerprint = row ? JSON.stringify(row) : '';
  // 正線卡需要 MQTT 補即時進度；整備卡的業務標籤與時間則以部署班表為準。
  // 若整備卡也套 operation/update，舊 retain 訊息會把使用者設定的 cardLabel 蓋掉。
  const useLiveMqtt = element.label === '正線班次' && !isPreviewMode && !isEditMode;
  const vehicleCode = row?.vehicle_code != null ? String(row.vehicle_code) : undefined;
  const liveRow = useOperationMqttShiftOverlay(vehicleCode, row, useLiveMqtt);
  const variables = useMemo(
    () => {
      const built = buildVariables(element, row, index, isEditMode);
      if (!useLiveMqtt) return built;
      return { ...built, ...liveRow };
    },
    [element.variableName, element.groupVariableMode, element.iteratorField, element.label, rowFingerprint, index, isEditMode, useLiveMqtt, liveRow],
  );
  const { designW, designH } = getTemplateDesignSize(element);
  const fallbackLayout =
    isPreviewMode && ((element.groupTileFit ?? 'fill') === 'fill' || element.groupTileFit === 'slot')
      ? computeGroupTileLayout(element, 1)
      : null;
  const posLeft = typeof style?.left === 'number' ? style.left : 0;
  const posTop = typeof style?.top === 'number' ? style.top : 0;
  const actualW =
    typeof style?.width === 'number'
      ? style.width
      : (fallbackLayout?.tileWidth ?? designW);
  const actualH =
    typeof style?.height === 'number'
      ? style.height
      : (fallbackLayout?.tileHeight ?? designH);
  const { scale, scaleX, scaleY, offsetX, offsetY, designW: canvasDesignW, designH: canvasDesignH } =
    getTemplateUniformScale(element, actualW, actualH);
  const tplScaleX = scaleX ?? scale;
  const tplScaleY = scaleY ?? scale;
  const tplScaled =
    Math.abs(tplScaleX - 1) > 0.0001 || Math.abs(tplScaleY - 1) > 0.0001;
  const previewBarH = 22;
  const wrapInTransition = animKey !== undefined && row !== null && !isEditMode;
  const useAbsoluteSlot = !wrapInTransition && (typeof style?.left === 'number' || typeof style?.top === 'number');

  const templateBody = (
    <VariableProvider variables={variables as Record<string, string | number | boolean>}>
      <EditModeProvider value={false}>
      <div
        className={wrapInTransition ? 'relative h-full w-full overflow-hidden' : useAbsoluteSlot ? 'absolute overflow-hidden' : 'relative overflow-hidden'}
        style={{
          ...(useAbsoluteSlot ? { left: posLeft, top: posTop } : {}),
          width: actualW,
          height: actualH,
          boxSizing: 'border-box',
          pointerEvents: isEditMode ? 'none' : 'auto',
          background: hideChrome
            ? 'transparent'
            : isPreviewMode
              ? 'rgba(139,92,246,0.06)'
              : 'rgba(255,255,255,0.02)',
          border: hideChrome
            ? 'none'
            : isPreviewMode
              ? '1px dashed rgba(139,92,246,0.4)'
              : '1px solid rgba(255,255,255,0.06)',
          borderRadius: hideChrome ? 0 : 6,
        }}
      >
        {isEditMode && isPreviewMode && (
          <div
            className="absolute top-0 left-0 right-0 z-10 flex items-center gap-1 px-2"
            style={{
              height: previewBarH,
              background: 'rgba(139,92,246,0.15)',
              borderBottom: '1px dashed rgba(139,92,246,0.3)',
              pointerEvents: 'none',
            }}
          >
            <Variable size={10} color="#a855f7" />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#a855f7', fontWeight: 'bold' }}>
              {`{${varName}}`}
            </span>
            <span style={{ fontSize: 9, color: 'rgba(168,85,247,0.5)', marginLeft: 'auto' }}>預覽範本</span>
          </div>
        )}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            paddingTop: isEditMode && isPreviewMode ? previewBarH : 0,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
              width: canvasDesignW,
              height: canvasDesignH,
              transform: tplScaled ? `scale(${tplScaleX}, ${tplScaleY})` : undefined,
              transformOrigin: 'top left',
              overflow: 'hidden',
            }}
          >
            {(element.children ?? []).map((child) => (
              <div
                key={child.id}
                style={{
                  position: 'absolute',
                  left: child.x,
                  top: child.y,
                  width: child.width,
                  height: child.height,
                  zIndex: child.type === 'color-block' ? 0 : child.type === 'alert-banner' || child.type === 'vehicle-alert-banner' ? 12 : 1,
                }}
              >
                <WidgetRenderer widget={child} />
              </div>
            ))}
          </div>
        </div>
      </div>
      </EditModeProvider>
    </VariableProvider>
  );

  if (wrapInTransition) {
    return (
      <SlotTransitionBox
        animKey={animKey}
        transition={slotTransition}
        style={{
          position: useAbsoluteSlot ? 'absolute' : 'relative',
          ...(useAbsoluteSlot ? { left: posLeft, top: posTop } : {}),
          width: actualW,
          height: actualH,
        }}
      >
        {templateBody}
      </SlotTransitionBox>
    );
  }
  return templateBody;
}

function rowSlotKey(
  element: CanvasElementProps,
  row: Record<string, unknown>,
  index: number,
): string {
  return String(row[element.slotKeyField || element.iteratorField || 'id'] ?? index);
}

function ScrollGroupView({
  element,
  rows,
  isPreviewMode,
  isEmpty,
  isLoading,
  isEditMode,
  onEnterEditMode,
}: {
  element: CanvasElementProps;
  rows: (Record<string, unknown> | null)[];
  isPreviewMode: boolean;
  isEmpty: boolean;
  isLoading: boolean;
  isEditMode: boolean;
  onEnterEditMode: () => void;
}) {
  const intervalSec = Math.max(2, element.groupScrollInterval ?? 5);
  const { tileWidth: tplW, tileHeight: tplH, padY } = computeGroupTileLayout(element, 1);
  const [activeIndex, setActiveIndex] = useState(0);
  const dataRows = rows.filter((r): r is Record<string, unknown> => r !== null);
  const rowFingerprint = JSON.stringify(
    dataRows.map((r, i) => rowSlotKey(element, r, i)),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [dataRows.length, rowFingerprint]);

  useEffect(() => {
    if (isEditMode || isPreviewMode || dataRows.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveIndex(i => (i + 1) % dataRows.length);
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [isEditMode, isPreviewMode, dataRows.length, intervalSec]);

  const barTop = Math.max(0, padY - 6);
  const singleRow = isPreviewMode
    ? null
    : dataRows[activeIndex % Math.max(dataRows.length, 1)] ?? null;
  const useScrollAnim = !isEditMode && !isPreviewMode && !isEmpty && dataRows.length > 1;
  const scrollAnimKey = useScrollAnim && singleRow
    ? rowSlotKey(element, singleRow, activeIndex)
    : undefined;

  if (isLoading && !isEditMode) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden text-xs text-zinc-500">
        <span className="animate-pulse">載入資料…</span>
      </div>
    );
  }

  if (isEmpty && !isEditMode) {
    if (isDualCanvasGroup(element) && (element.childrenDefault?.length ?? 0) > 0) {
      return (
        <DualCanvasDefaultView
          element={element}
          isEditMode={isEditMode}
          onEnterEditMode={onEnterEditMode}
        />
      );
    }
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden text-xs text-zinc-600">
        尚無資料
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ padding: `${padY}px 6px` }}>
      <div
        style={{
          position: 'relative',
          width: tplW,
          height: tplH,
          margin: barTop > 0 ? `${barTop}px auto 0` : '0 auto',
          overflow: 'hidden',
          borderRadius: 6,
        }}
      >
        <TemplateInstance
          element={element}
          row={singleRow}
          index={activeIndex}
          isEditMode={isEditMode}
          animKey={scrollAnimKey}
          slotTransition="fade"
          style={{ position: 'relative', width: '100%', height: tplH, maxWidth: tplW }}
        />
      </div>
      {!isEditMode && !isPreviewMode && dataRows.length > 1 && (
        <div style={{
            position: 'absolute',
            top: '50%',
            right: 6,
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          {dataRows.map((_, i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: i === activeIndex % dataRows.length ? '#a855f7' : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotsGroupView({
  element,
  rows,
  isPreviewMode,
  isEditMode,
}: {
  element: CanvasElementProps;
  rows: (Record<string, unknown> | null)[];
  isPreviewMode: boolean;
  isEditMode: boolean;
}) {
  const slotCount = Math.max(1, element.slotCount ?? element.gridColumns ?? 6);
  const { tileWidth: tplW, tileHeight: tplH, padX, padY, gapX } = computeGroupTileLayout(
    element,
    slotCount,
    { gridColumns: slotCount },
  );
  const dataRows = rows.filter((r): r is Record<string, unknown> => r !== null);
  const keyField = element.slotKeyField || element.iteratorField || 'order_id';
  const usePool = (element.groupSlotAssignment ?? 'sticky-pool') === 'sticky-pool';
  const transition = element.groupTransition ?? 'flip';
  const rowFingerprint = JSON.stringify(
    dataRows.map((r, i) => rowSlotKey(element, r, i)),
  );

  const poolRef = useRef<import('../utils/groupSlotPool').SlotCell[]>(
    Array.from({ length: slotCount }, () => null),
  );
  const [animKeys, setAnimKeys] = useState<string[]>(() =>
    Array.from({ length: slotCount }, (_, i) => `empty-${i}`),
  );

  const poolResult = useMemo(() => {
    if (isPreviewMode || !usePool) return null;
    const result = assignStickyPoolSlots(poolRef.current, dataRows, keyField, slotCount);
    poolRef.current = result.slots;
    return result;
  }, [rowFingerprint, keyField, slotCount, isPreviewMode, usePool]);

  useEffect(() => {
    if (!poolResult || isEditMode) return;
    setAnimKeys(prev => {
      let changed = false;
      const next = [...prev];
      for (const i of poolResult.changedIndices) {
        const cell = poolResult.slots[i];
        const key = cell ? cell.key : `empty-${i}`;
        if (next[i] !== key) {
          next[i] = key;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [poolResult, isEditMode]);

  const indexSlots = useMemo(() => {
    if (isPreviewMode) {
      return Array.from({ length: slotCount }, () => null);
    }
    if (isEditMode) {
      return Array.from({ length: slotCount }, (_, i) => (i === 0 ? (dataRows[0] ?? null) : null));
    }
    if (!usePool) {
      return Array.from({ length: slotCount }, (_, i) => dataRows[i] ?? null);
    }
    const fromPool = poolResult?.slots.map(c => c?.row ?? null);
    if (fromPool?.some(Boolean)) return fromPool;
    return Array.from({ length: slotCount }, (_, i) => dataRows[i] ?? null);
  }, [isPreviewMode, isEditMode, slotCount, dataRows, usePool, poolResult]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ padding: `${padY}px ${padX}px` }}>
      <div className="relative" style={{ width: '100%', height: tplH }}>
        {indexSlots.map((row, i) => {
          const showTemplate = isEditMode ? i === 0 : true;
          const animKey = usePool && !isPreviewMode && !isEditMode
            ? animKeys[i]
            : row
              ? String(row[keyField] ?? `${i}`)
              : undefined;
          return (
            <div
              key={`slot-${i}`}
              style={{
                position: 'absolute',
                left: i * (tplW + gapX),
                top: 0,
                width: tplW,
                height: tplH,
                boxSizing: 'border-box',
                borderRadius: 6,
                border: isEditMode && i > 0
                  ? '1px dashed rgba(148,163,184,0.35)'
                  : '1px solid transparent',
                background: isEditMode && i > 0 ? 'rgba(15,23,42,0.35)' : 'transparent',
              }}
            >
              {showTemplate && (isEditMode || row) ? (
                <TemplateInstance
                  element={element}
                  row={isEditMode && i === 0 ? (row ?? null) : row}
                  index={i}
                  isEditMode={isEditMode}
                  animKey={animKey}
                  slotTransition={isEditMode || isPreviewMode ? 'none' : (transition === 'flip' ? 'fade' : transition)}
                  style={{
                    position: 'relative',
                    left: 0,
                    top: 0,
                    width: tplW,
                    height: tplH,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TileGroupView({
  element,
  rows,
  isEditMode,
}: {
  element: CanvasElementProps;
  rows: (Record<string, unknown> | null)[];
  isEditMode: boolean;
}) {
  const layoutMode = element.layoutMode || 'grid';
  const itemCount = Math.max(1, rows.length);
  const layout = computeGroupTileLayout(element, itemCount);
  const { tileWidth: tplW, tileHeight: tplH, padX, padY, gapX, gapY, layoutCols } = layout;

  const titleText = (element.headerTitle
    ?? (element.label === '載具操作' || element.label === '載具控制' ? '載具控制' : '')
  ).trim();
  const hasHeader = titleText.length > 0;
  const titleFs = Math.max(10, Math.min(48, element.headerTitleFontSize ?? 14));
  const headerH = hasHeader ? Math.round(titleFs * 1.4) + 4 : 0;

  return (
    <div className="absolute inset-0 overflow-visible" style={{ padding: `${padY}px ${padX}px` }}>
      {hasHeader && (
        <div
          className="absolute left-0 right-0 top-0 z-10 flex items-center px-0.5 select-none"
          style={{ height: headerH, pointerEvents: 'none' }}
        >
          <span
            className="font-bold tracking-wide text-zinc-400"
            style={{ fontSize: titleFs, lineHeight: 1.2 }}
          >
            {titleText}
          </span>
        </div>
      )}
      <div className="relative h-full w-full">
        {rows.map((row, index) => {
          let x = 0;
          let y = headerH;
          if (layoutMode === 'grid') {
            const col = index % layoutCols;
            const r = Math.floor(index / layoutCols);
            x = col * (tplW + gapX);
            y = headerH + r * (tplH + gapY);
          } else {
            const rx = element.xField && row ? Number(row[element.xField]) : 0;
            const ry = element.yField && row ? Number(row[element.yField]) : 0;
            x = Number.isNaN(rx) ? 0 : rx;
            y = headerH + (Number.isNaN(ry) ? 0 : ry);
          }
          return (
            <TemplateInstance
              key={index}
              element={element}
              row={row}
              index={index}
              isEditMode={isEditMode}
              style={{ left: x, top: y, width: tplW, height: tplH }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function GroupCanvasRenderer({ element, isEditMode, isCanvasSelected, onEnterEditMode }: Props) {
  const gate = element.displayGate;
  const builtinSql = resolveBuiltinGroupSql(element);
  const gateSql = gate?.sqlQuery?.trim() ? gate.sqlQuery : builtinSql.sqlQuery;
  const gateDs = gate?.dataSourceId || element.dataSourceId;

  const { data, loading } = useWidgetData({
    dataSourceId: element.dataSourceId,
    sqlQuery: builtinSql.sqlQuery,
    dataUrl: element.dataUrl,
    refreshInterval: builtinSql.refreshInterval ?? element.refreshInterval,
    refreshMode: element.refreshMode,
    invalidateTags: element.invalidateTags,
  });

  const gateSameAsMain = gate?.sqlQuery?.trim()
    && gateSql === element.sqlQuery?.trim()
    && gateDs === element.dataSourceId;

  const gateQuery = useWidgetData({
    dataSourceId: isDualCanvasGroup(element) && gate?.sqlQuery?.trim() && !gateSameAsMain ? gateDs : undefined,
    sqlQuery: isDualCanvasGroup(element) && gate?.sqlQuery?.trim() && !gateSameAsMain ? gateSql : undefined,
    refreshInterval: gate?.refreshInterval ?? element.refreshInterval,
    refreshMode: gate?.refreshMode ?? element.refreshMode,
    invalidateTags: gate?.invalidateTags ?? element.invalidateTags,
  });

  const hasDataSource = !!(element.dataSourceId || element.dataUrl);
  const isPreviewMode = !hasDataSource;
  const isLoading = hasDataSource && loading;
  const isShiftRoster = isShiftRosterGroup(element.label);
  const fleetMqtt = useShiftFleetMqttMap();
  const dataRows = hasDataSource && data.length > 0 ? data : [];
  const mergedRows = useMemo(() => {
    if (!isShiftRoster || isEditMode || isPreviewMode) return dataRows;
    if (element.label === '正線班次') {
      return mergeMainlineShiftRoster(dataRows, fleetMqtt);
    }
    if (element.label === '整備班表') {
      return mergeMaintenanceShiftRoster(dataRows, fleetMqtt);
    }
    return dataRows;
  }, [isShiftRoster, isEditMode, isPreviewMode, element.label, dataRows, fleetMqtt]);
  const isEmpty = hasDataSource && !loading && mergedRows.length === 0;
  const rows: (Record<string, unknown> | null)[] = isPreviewMode ? [null] : mergedRows;

  const gateRows = gateSameAsMain ? data : (gate?.sqlQuery?.trim() ? gateQuery.data : data);
  const gateRowCount = gateRows.length;
  const gateFirst = gateRows[0] ?? null;
  const showNormalPanel = !isDualCanvasGroup(element) || isEditMode
    ? true
    : shouldShowNormalPanel(element, gateRowCount, gateFirst);

  const renderElement = isDualCanvasGroup(element)
    ? { ...element, children: getNormalChildren(element) }
    : element;

  const mode = element.groupRepeatMode || 'tile';

  if (isDualCanvasGroup(element) && !showNormalPanel && !isEditMode) {
    return (
      <DualCanvasDefaultView
        element={element}
        isEditMode={isEditMode}
        onEnterEditMode={onEnterEditMode}
      />
    );
  }

  return (
    <div className={`relative w-full h-full ${mode === 'tile' ? 'overflow-visible' : 'overflow-hidden'}`}>
      {mode === 'scroll' && (
        <ScrollGroupView
          element={renderElement}
          rows={rows}
          isPreviewMode={isPreviewMode}
          isEmpty={isEmpty}
          isLoading={isLoading}
          isEditMode={isEditMode}
          onEnterEditMode={onEnterEditMode}
        />
      )}
      {mode === 'slots' && (
        <SlotsGroupView element={renderElement} rows={rows} isPreviewMode={isPreviewMode} isEditMode={isEditMode} />
      )}
      {mode === 'tile' && (
        <TileGroupView element={renderElement} rows={rows} isEditMode={isEditMode} />
      )}

      {isEditMode && isCanvasSelected && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center rounded"
          style={{ pointerEvents: 'none' }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEnterEditMode();
            }}
            className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2 text-sm font-bold pointer-events-auto"
          >
            <Edit3 size={16} /> 編輯子畫布範本
          </button>
        </div>
      )}
    </div>
  );
}
