import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CanvasElementProps } from '../types';
import { useWidgetData } from './useWidgetData';
import { resolveBuiltinGroupSql } from '../utils/resolveBuiltinGroupSql';
import { VariableProvider } from '../VariableContext';
import { WidgetRenderer } from './WidgetRenderer';
import { computeGroupTileLayout, getTemplateDesignSize, getTemplateUniformScale } from './groupTileLayout';
import { EditModeProvider } from '../context/EditModeContext';
import { assignStickyPoolSlots } from '../utils/groupSlotPool';
import { useGenericGroupSlots } from './useGenericGroupSlots';
import {
  getNormalChildren,
  isDualCanvasGroup,
  shouldShowNormalPanel,
} from '../utils/dualCanvas';
import { DualCanvasDefaultView } from './DualCanvasDefaultView';
import { useShiftSourcePostProcessors } from '../hooks/useShiftSourcePostProcessors';
import { useOperationMqttShiftOverlay } from '../hooks/useOperationMqttShiftOverlay';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import {
  hasLiveReport,
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
) {
  // 沒有列（未接資料來源的預覽）就只放索引變數；不再注入示範列，欄位會顯示成 {欄位名}
  const varName = element.variableName || 'item';
  const indexMode = (element.groupVariableMode ?? 'row') === 'index';
  const varValue = indexMode
    ? index
    : row
      ? (element.iteratorField ? row[element.iteratorField] : index)
      : index;
  const variables: Record<string, unknown> = { [varName]: varValue };
  if (!indexMode && row) {
    Object.entries(row).forEach(([k, v]) => { variables[k] = v; });
  }
  return variables;
}

/** 舊群組的轉場設定（groupTransition）與新泛用群組的轉場設定（genericGroup.transitionConfig）共用同一個盒子。 */
export type SlotTransitionType = 'none' | 'fade' | 'flip' | 'flip-up';

function SlotTransitionBox({
  children,
  className = '',
  style,
  animKey,
  transition = 'flip',
  durationMs,
  enterOnMount = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  animKey?: string;
  transition?: SlotTransitionType;
  /** 泛用群組可自訂轉場時間；舊群組不傳，沿用各轉場原本的預設值 */
  durationMs?: number;
  /** 掛載時從退場狀態翻進來（依身分渲染的格位：新進項目要有進場效果） */
  enterOnMount?: boolean;
}) {
  const flipMs = transition === 'flip-up' ? (durationMs ?? 380) : 520;
  const skipAnim = transition === 'none' || animKey === undefined;
  const [phase, setPhase] = useState<'in' | 'out'>(() => (enterOnMount && !skipAnim ? 'out' : 'in'));

  useEffect(() => {
    if (phase !== 'out' || !enterOnMount) return;
    // 先讓退場狀態畫出一幀，轉場才有起點
    const t = window.setTimeout(() => setPhase('in'), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [shown, setShown] = useState<{ key?: string; node: ReactNode }>({ key: animKey, node: children });
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useEffect(() => {
    if (skipAnim) return;
    if (animKey === shown.key) return;
    setPhase('out');
    const outMs = transition === 'flip' ? flipMs * 0.42 : transition === 'flip-up' ? flipMs * 0.5 : 50;
    const t = window.setTimeout(() => {
      setShown({ key: animKey, node: childrenRef.current });
      setPhase('in');
    }, outMs);
    return () => clearTimeout(t);
  }, [skipAnim, animKey, shown.key, transition, flipMs]);

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

  if (transition === 'flip-up') {
    // 向上翻頁：舊卡往上翻出／淡出，新卡從原位「翻」進來——不是左右滑動，
    // 是單一元素在同一個位置做垂直位移＋透明度轉場，跟班表／航班資訊看板的
    // 翻頁效果同一種視覺語彙，但不用真的做兩片式 3D 翻牌（成本高、這裡不需要）。
    return (
      <div
        className={className}
        style={{
          ...style,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: phase === 'in' ? 'translateY(0)' : 'translateY(-14%)',
            opacity: phase === 'in' ? 1 : 0,
            transition: `transform ${flipMs}ms cubic-bezier(0.22, 0.9, 0.28, 1), opacity ${flipMs}ms ease`,
          }}
        >
          {visibleNode}
        </div>
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
  transitionDurationMs,
  liveMqttEnabled,
  template,
  enterOnMount,
}: {
  element: CanvasElementProps;
  row: Record<string, unknown> | null;
  index: number;
  style?: CSSProperties;
  animKey?: string;
  isEditMode: boolean;
  slotTransition?: SlotTransitionType;
  transitionDurationMs?: number;
  enterOnMount?: boolean;
  /**
   * 覆寫「正線班次才疊 MQTT」的舊寫死判斷。未傳時維持原行為（比對 label 字串），
   * 泛用群組路徑一律明確傳 false——即時疊加交給來源自己在候選項目成形前做好
   * （見 groupCandidates 管線），不是每個樣板各自認 label。
   */
  liveMqttEnabled?: boolean;
  /**
   * 泛用群組依條件選出的樣板；未傳時沿用 element.children（舊行為）。傳整個
   * `GroupTemplateDef`（不是只傳 children）是因為樣板可能有自己的設計尺寸
   * （`templateWidth`/`templateHeight`）——不同樣板的原始卡片大小常常不一樣，
   * 縮放比例要用「這套樣板自己的」尺寸算，不能套用群組共用的那一份。
   */
  template?: import('../types').GroupTemplateDef | null;
}) {
  const isPreviewMode = row === null;
  const hideChrome = !!element.templateHideChrome && !isPreviewMode;
  const varName = element.variableName || 'item';
  const rowFingerprint = row ? JSON.stringify(row) : '';
  const effectiveChildren = template?.children ?? element.children ?? [];
  // 正線卡需要 MQTT 補即時進度；整備卡的業務標籤與時間則以部署班表為準。
  // 若整備卡也套 operation/update，舊 retain 訊息會把使用者設定的 cardLabel 蓋掉。
  const useLiveMqtt = liveMqttEnabled ?? (element.label === '正線班次' && !isPreviewMode && !isEditMode);
  const vehicleCode = row?.vehicle_code != null ? String(row.vehicle_code) : undefined;
  const liveRow = useOperationMqttShiftOverlay(vehicleCode, row, useLiveMqtt);
  const variables = useMemo(
    () => {
      const built = buildVariables(element, row, index);
      if (!useLiveMqtt) return built;
      return { ...built, ...liveRow };
    },
    [element.variableName, element.groupVariableMode, element.iteratorField, element.label, rowFingerprint, index, isEditMode, useLiveMqtt, liveRow],
  );
  // 多樣板時，設計尺寸／縮放要依「這個樣板自己的子元件範圍與設計尺寸」算，不是
  // 群組共用的 element.children／templateWidth——樣板之間的畫面內容大小本來就
  // 可能不同（如遷移既有卡片時，正線卡跟整備卡本來就不是同一個尺寸畫的）。
  const layoutElement = template
    ? {
        ...element,
        children: template.children,
        templateWidth: template.templateWidth ?? element.templateWidth,
        templateHeight: template.templateHeight ?? element.templateHeight,
      }
    : element;
  const { designW, designH } = getTemplateDesignSize(layoutElement);
  const fallbackLayout =
    isPreviewMode && ((element.groupTileFit ?? 'fill') === 'fill' || element.groupTileFit === 'slot')
      ? computeGroupTileLayout(layoutElement, 1)
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
    getTemplateUniformScale(layoutElement, actualW, actualH);
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
            {effectiveChildren.map((child) => (
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
        durationMs={transitionDurationMs}
        enterOnMount={enterOnMount}
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

/**
 * 泛用群組（`genericGroup.enabled`）的可見格位渲染。跟舊 `SlotsGroupView` 平行
 * 存在、互不影響——資料管線（多來源／有效性／優先程度／候補）在
 * `useGenericGroupSlots` 裡，樣板選擇也是每格各自決定，這裡只負責把結果排版
 * ＋接上轉場。共用同一個 `groupTileLayout`（規格 §7：所有樣板共用一個格位池，
 * 不按樣板預留位置）。
 */
function GenericSlotsGroupView({
  element,
  isEditMode,
  isPreviewMode,
}: {
  element: CanvasElementProps;
  isEditMode: boolean;
  isPreviewMode: boolean;
}) {
  const config = element.genericGroup;
  const capacity = Math.max(1, config?.capacityConfig?.capacity ?? element.slotCount ?? element.gridColumns ?? 6);
  const overflowFill = config?.capacityConfig?.overflowFill ?? 'blank';
  const showPendingCount = config?.capacityConfig?.showPendingCount ?? false;
  const transitionType = config?.transitionConfig?.type ?? 'flip-up';
  const transitionDurationMs = config?.transitionConfig?.durationMs;

  /*
   * 場域專屬的來源後處理表——不是平台邏輯，是「這個儀表板頁面」自己決定要提供
   * 哪些後處理器；平台的 useGenericGroupSlots／groupCandidates.ts 完全不認得
   * 'mainline-mqtt-merge' 這個字串，只是原封查表。正線班次來源設定
   * `postProcessId: 'mainline-mqtt-merge'` 才會套用；其他群組／其他來源不受影響。
   */
  const sourcePostProcessors = useShiftSourcePostProcessors();

  const { fetchers, slots, pendingCount, isInitialLoading, templatesBySlot, sourceStates } = useGenericGroupSlots(config, capacity, {
    sourcePostProcessors,
  });
  // 查詢失敗跟「查無資料」分開顯示：失敗時不能讓人以為是沒有訂單
  const sourceError = (config?.sources ?? [])
    .map((source) => sourceStates[source.id]?.error)
    .find((error): error is string => Boolean(error));

  const occupiedCount = slots.filter(Boolean).length;
  // stretch：欄數＝實際筆數（撐滿、無空格）；blank：欄數固定＝容量（資料不足時留空格）
  const layoutCols = overflowFill === 'stretch' ? Math.max(1, occupiedCount) : capacity;
  const { tileWidth: tplW, tileHeight: tplH, padX, padY, gapX } = computeGroupTileLayout(
    element,
    layoutCols,
    { gridColumns: layoutCols },
  );
  const visibleSlots = overflowFill === 'stretch' ? slots.slice(0, occupiedCount) : slots;

  // 依身分（uid）渲染：同一張卡換位置是位移，不是換卡翻頁。DOM 順序固定用 uid 排，
  // 讓 React 只改 left、不搬動節點——節點被搬動時瀏覽器不會播放 left 的轉場。
  const placed = visibleSlots
    .map((cell, i) => (cell ? { cell, i } : null))
    .filter((x): x is { cell: NonNullable<typeof slots[number]>; i: number } => x !== null)
    .sort((a, b) => (a.cell.uid < b.cell.uid ? -1 : a.cell.uid > b.cell.uid ? 1 : 0));
  const moveMs = transitionType === 'none' ? 0 : (transitionDurationMs ?? 450);
  // 第一次有資料時整排一起出現，不要每張卡都播進場
  const hasShownDataRef = useRef(false);
  const enterOnMount = hasShownDataRef.current && !isEditMode && transitionType !== 'none';
  useEffect(() => {
    if (occupiedCount > 0) hasShownDataRef.current = true;
  }, [occupiedCount]);

  if (isPreviewMode && !isEditMode) {
    // 執行畫面不顯示範本卡：沒有接資料來源就是沒有資料
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden text-xs text-zinc-600" data-group-empty="no-source">
        尚無資料
      </div>
    );
  }

  if (isPreviewMode) {
    // 編輯模式下未接資料來源：顯示第一套樣板（或 children 備援）當預覽範本
    return (
      <div className="relative w-full h-full overflow-hidden" style={{ padding: `${padY}px ${padX}px` }}>
        <TemplateInstance
          element={element}
          row={null}
          index={0}
          isEditMode={isEditMode}
          liveMqttEnabled={false}
          template={config?.templates?.[0]}
          style={{ position: 'relative', left: 0, top: 0, width: tplW, height: tplH }}
        />
      </div>
    );
  }

  return (
    <>
      {fetchers}
      <div className="relative w-full h-full overflow-hidden" data-generic-group={element.id} style={{ padding: `${padY}px ${padX}px` }}>
        {isInitialLoading && occupiedCount === 0 ? (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden text-xs text-zinc-500">
            <span className="animate-pulse">載入資料…</span>
          </div>
        ) : occupiedCount === 0 ? (
          <div
            className={`relative flex h-full w-full items-center justify-center overflow-hidden text-xs ${sourceError ? 'text-rose-400' : 'text-zinc-600'}`}
            title={sourceError}
            data-group-empty={sourceError ? 'error' : 'empty'}
          >
            {sourceError ? '資料讀取失敗' : '尚無資料'}
          </div>
        ) : (
          <div className="relative" style={{ width: '100%', height: tplH }}>
            {placed.map(({ cell, i }) => (
              <div
                key={cell.uid}
                data-slot-uid={cell.uid}
                data-row-origin={hasLiveReport(cell.row) ? 'sql+mqtt' : 'sql'}
                style={{
                  position: 'absolute',
                  left: i * (tplW + gapX),
                  top: 0,
                  width: tplW,
                  height: tplH,
                  boxSizing: 'border-box',
                  transition: isEditMode || moveMs === 0 ? undefined : `left ${moveMs}ms cubic-bezier(0.22, 0.9, 0.28, 1)`,
                }}
              >
                <TemplateInstance
                  element={element}
                  row={cell.row}
                  index={i}
                  isEditMode={isEditMode}
                  // 同一張卡內容版本或樣板換了才翻頁（規格 §7）；單純數值更新原地換，
                  // 單純換位置由外層 left 轉場處理。
                  animKey={`${cell.contentVersion ?? ''}::${templatesBySlot[i]?.id ?? ''}`}
                  slotTransition={isEditMode ? 'none' : transitionType}
                  transitionDurationMs={transitionDurationMs}
                  enterOnMount={enterOnMount}
                  liveMqttEnabled={false}
                  template={templatesBySlot[i]}
                  style={{ position: 'relative', left: 0, top: 0, width: tplW, height: tplH }}
                />
              </div>
            ))}
          </div>
        )}
        {sourceError && occupiedCount > 0 && (
          <div
            className="absolute top-1 right-1 rounded px-2 py-0.5 text-[10px] text-rose-300"
            style={{ background: 'rgba(15,23,42,0.75)', pointerEvents: 'none' }}
            title={sourceError}
          >
            資料讀取失敗
          </div>
        )}
        {showPendingCount && pendingCount > 0 && (
          <div
            className="absolute bottom-1 right-1 rounded px-2 py-0.5 text-[10px] text-zinc-400"
            style={{ background: 'rgba(15,23,42,0.6)', pointerEvents: 'none' }}
          >
            +{pendingCount} 未顯示
          </div>
        )}
      </div>
    </>
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
  const useGenericGroup = !!element.genericGroup?.enabled;
  // 泛用群組取代單一資料綁定與單一範本：雙畫板閘道只看群組本身的單一查詢，
  // 泛用群組沒有那份資料，閘道永遠判成 0 筆，檢視模式會一直落在空的預設畫板。
  const isDual = !useGenericGroup && isDualCanvasGroup(element);
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
    dataSourceId: isDual && gate?.sqlQuery?.trim() && !gateSameAsMain ? gateDs : undefined,
    sqlQuery: isDual && gate?.sqlQuery?.trim() && !gateSameAsMain ? gateSql : undefined,
    refreshInterval: gate?.refreshInterval ?? element.refreshInterval,
    refreshMode: gate?.refreshMode ?? element.refreshMode,
    invalidateTags: gate?.invalidateTags ?? element.invalidateTags,
  });

  // 泛用群組的資料來自 genericGroup.sources[]，不是群組本身的 dataSourceId——
  // 舊的「有沒有接資料來源」判斷不能沿用，不然設定了來源還是會被當成預覽模式。
  const isGenericGroupWithSources = !!element.genericGroup?.enabled && (element.genericGroup.sources?.length ?? 0) > 0;
  const hasDataSource = isGenericGroupWithSources || !!(element.dataSourceId || element.dataUrl);
  const isPreviewMode = !hasDataSource;
  const isLoading = hasDataSource && loading;
  const isShiftRoster = isShiftRosterGroup(element.label);
  const fleetMqtt = useShiftFleetMqttMap();
  const dataRows = hasDataSource && data.length > 0 ? data : [];
  const mergedRows = useMemo(() => {
    // 編輯模式也合併 MQTT：編輯畫面看到的值要跟執行畫面同一份
    if (!isShiftRoster || isPreviewMode) return dataRows;
    if (element.label === '正線班次') {
      return mergeMainlineShiftRoster(dataRows, fleetMqtt);
    }
    if (element.label === '整備班表') {
      return mergeMaintenanceShiftRoster(dataRows, fleetMqtt);
    }
    return dataRows;
  }, [isShiftRoster, isPreviewMode, element.label, dataRows, fleetMqtt]);
  const isEmpty = hasDataSource && !loading && mergedRows.length === 0;
  // 範本卡（row=null）只在編輯器出現；執行畫面沒有來源就是空的
  const rows: (Record<string, unknown> | null)[] = isPreviewMode && isEditMode ? [null] : mergedRows;

  const gateRows = gateSameAsMain ? data : (gate?.sqlQuery?.trim() ? gateQuery.data : data);
  const gateRowCount = gateRows.length;
  const gateFirst = gateRows[0] ?? null;
  const showNormalPanel = !isDual || isEditMode
    ? true
    : shouldShowNormalPanel(element, gateRowCount, gateFirst);

  const renderElement = isDual
    ? { ...element, children: getNormalChildren(element) }
    : element;

  const mode = element.groupRepeatMode || 'tile';

  if (isDual && !showNormalPanel && !isEditMode) {
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
      {useGenericGroup ? (
        <GenericSlotsGroupView element={renderElement} isEditMode={isEditMode} isPreviewMode={isPreviewMode} />
      ) : (
        <>
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
        </>
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
