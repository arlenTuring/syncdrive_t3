import * as LucideIcons from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AlertBannerWidget, AlertRule } from '../types';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { useVariables, interpolateVariables, type VariableMap } from '../VariableContext';
import { useEditMode } from '../context/EditModeContext';
import { isVariableTemplate } from '../utils/widgetEditPreview';
import {
  createEmptyAlertRule,
  evaluateActiveAlertRules,
  getEditorAlertRules,
  pickPrimaryAlertRules,
} from '../utils/alertTrigger';

const BLINK_STYLE_ID = 'syncdrive-alert-blink-keyframes';
const ROW_GAP = 2;
const DEFAULT_CAROUSEL_MS = 3200;

function resolveAlertDisplayText(content: string, variables: VariableMap, isEditMode: boolean): string {
  const interpolated = interpolateVariables(content, variables);
  if (!isEditMode) return interpolated;
  // 編輯模式：有資料就顯示資料，沒有就留著 {欄位名}，不換成示範文字
  return interpolated.trim() || '（無警示）';
}

/** 依元件高度與列數推算字級，不超出每列可用高度 */
export function computeAlertFontSize(
  boxHeight: number,
  rowCount: number,
  baseSize: number,
  reservedHeight = 0,
): number {
  if (rowCount <= 0 || boxHeight <= 0) return baseSize;
  const usable = boxHeight - reservedHeight - ROW_GAP * Math.max(0, rowCount - 1);
  const rowH = usable / rowCount;
  const fromHeight = Math.floor((rowH - 6) * 0.78);
  return Math.max(9, Math.min(baseSize, fromHeight));
}

function useBlinkKeyframes() {
  useEffect(() => {
    if (document.getElementById(BLINK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = BLINK_STYLE_ID;
    style.textContent = `
      @keyframes syncdrive-alert-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      @keyframes syncdrive-alert-carousel-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }, []);
}

function AlertRuleRow({
  rule,
  text,
  isPreview,
  fontSize,
  fontWeight,
  fontFamily,
  borderRadius,
  nowrap,
  icon,
  iconImage,
  flexGrow,
  animateIn,
}: {
  rule: AlertRule;
  text: string;
  isPreview: boolean;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  borderRadius: number;
  nowrap: boolean;
  icon?: string;
  iconImage?: string;
  flexGrow?: number;
  animateIn?: boolean;
}) {
  const IconComponent = icon ? (LucideIcons as any)[icon] : null;
  const iconPx = Math.min(fontSize + 3, 16);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '2px 5px',
        boxSizing: 'border-box',
        background: isPreview ? `${rule.backgroundColor}33` : rule.backgroundColor,
        border: isPreview ? `1px dashed ${rule.borderColor}` : `1px solid ${rule.borderColor}`,
        borderRadius,
        flex: flexGrow ? `${flexGrow} 1 0` : undefined,
        minHeight: 0,
        maxHeight: '100%',
        height: flexGrow ? '100%' : undefined,
        overflow: 'hidden',
        animation: !isPreview && rule.displayMode === 'blink'
          ? 'syncdrive-alert-blink 1.1s ease-in-out infinite'
          : animateIn
            ? 'syncdrive-alert-carousel-in 0.35s ease-out'
            : undefined,
        opacity: isPreview ? 0.65 : 1,
      }}
    >
      {iconImage ? (
        <img
          src={iconImage}
          alt=""
          style={{ width: iconPx, height: iconPx, objectFit: 'contain', flexShrink: 0 }}
        />
      ) : IconComponent ? (
        <IconComponent size={iconPx} strokeWidth={2.5} color={rule.textColor} style={{ flexShrink: 0 }} />
      ) : null}
      <span
        style={{
          fontSize,
          fontWeight,
          lineHeight: 1.15,
          color: rule.textColor,
          fontFamily,
          whiteSpace: nowrap ? 'nowrap' : 'pre-wrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'center',
          minWidth: 0,
          flex: 1,
        }}
      >
        {text || '（未設定文字）'}
      </span>
    </div>
  );
}

export function AlertBannerWidgetView({ widget }: { widget: AlertBannerWidget }) {
  useBlinkKeyframes();
  const isEditMode = useEditMode();
  const variables = useVariables();

  const sqlData = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
  });

  const resolvedMqttTopic = widget.mqttTopic
    ? interpolateVariables(widget.mqttTopic, variables)
    : undefined;

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: resolvedMqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  const sqlRow = sqlData.data[0] ?? null;
  const activeRules = pickPrimaryAlertRules(
    evaluateActiveAlertRules(widget, variables, sqlRow, mqttData.data),
  );
  const allRules = getEditorAlertRules(widget);
  const isCarousel = (widget.alertPresentation ?? 'stack') === 'carousel';

  const baseFontSize = widget.fontSize ?? 11;
  const fontWeight = widget.fontWeight ?? 'bold';
  const fontFamily = widget.fontFamily ?? 'system-ui, sans-serif';
  const borderRadius = widget.borderRadius ?? 4;
  const nowrap = widget.textWrap !== 'wrap';
  const carouselMs = Math.max(1200, widget.carouselIntervalMs ?? DEFAULT_CAROUSEL_MS);

  const stackRows: { rule: AlertRule; text: string; isPreview: boolean }[] =
    activeRules.length > 0
      ? activeRules.map(rule => ({
        rule,
        text: isEditMode
          ? resolveAlertDisplayText(rule.content || widget.content || '警示預覽', variables, true)
          : interpolateVariables(rule.displayText, variables),
        isPreview: false,
      }))
      : isEditMode && allRules.length === 0
        ? [{
          rule: createEmptyAlertRule(),
          text: widget.content?.trim() && !isVariableTemplate(widget.content)
            ? widget.content.trim()
            : '請在屬性面板新增警示規則',
          isPreview: true,
        }]
        : [];

  const carouselPool = stackRows;
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    setCarouselIndex(0);
  }, [carouselPool.map(r => r.rule.id).join('|')]);

  useEffect(() => {
    if (!isCarousel || carouselPool.length <= 1) return undefined;
    const t = window.setInterval(() => {
      setCarouselIndex(i => (i + 1) % carouselPool.length);
    }, carouselMs);
    return () => window.clearInterval(t);
  }, [isCarousel, carouselPool.length, carouselMs]);

  const displayRows = isCarousel
    ? (carouselPool.length > 0
      ? [carouselPool[carouselIndex % carouselPool.length]]
      : [])
    : stackRows;
  const rowCount = displayRows.length;
  const fontSize = useMemo(
    () => computeAlertFontSize(widget.height, Math.max(1, rowCount), baseFontSize),
    [widget.height, rowCount, baseFontSize],
  );

  if (activeRules.length === 0 && !(isEditMode && allRules.length === 0)) {
    return <div style={{ width: '100%', height: '100%' }} />;
  }

  const multiRow = !isCarousel && stackRows.length > 1;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        gap: ROW_GAP,
        overflow: 'hidden',
      }}
    >
      {displayRows.map(({ rule, text, isPreview }) => (
        <AlertRuleRow
          key={isCarousel ? `${rule.id}-${carouselIndex}` : rule.id}
          rule={rule}
          text={text}
          isPreview={isPreview}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fontFamily={fontFamily}
          borderRadius={borderRadius}
          nowrap={nowrap}
          icon={widget.icon}
          iconImage={widget.iconImage}
          flexGrow={multiRow ? 1 : undefined}
          animateIn={isCarousel && !isPreview}
        />
      ))}
    </div>
  );
}
