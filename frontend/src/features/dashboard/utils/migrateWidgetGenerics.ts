import type { ChildWidget } from '../types';
import { migrateBehaviorActionRules } from '../../vehicle-editor/constants/behaviorActionCatalog';

type LegacyWidget = Record<string, unknown> & { type: string };

/** 載入平面時將舊版場域化屬性／變體遷移為泛用命名 */
export function migrateChildWidgetGenerics(child: ChildWidget): ChildWidget {
  const w = { ...child } as LegacyWidget;

  if (w.type === 'text') {
    if (w.eventSeverityText !== undefined && w.severityTextColor === undefined) {
      w.severityTextColor = Boolean(w.eventSeverityText);
      delete w.eventSeverityText;
    }
    if (w.verticalAlign === undefined) {
      w.verticalAlign = 'center';
    }
  }

  if (w.type === 'color-block') {
    if (w.eventSeverityStrip !== undefined && w.severityStripColor === undefined) {
      w.severityStripColor = Boolean(w.eventSeverityStrip);
      delete w.eventSeverityStrip;
    }
    if (w.bindBorderFromMqttHealth !== undefined && w.bindBorderFromHealthField === undefined) {
      w.bindBorderFromHealthField = Boolean(w.bindBorderFromMqttHealth);
      if (!w.healthFieldForBorder) w.healthFieldForBorder = 'overall_health';
      delete w.bindBorderFromMqttHealth;
    }
  }

  if (w.type === 'gauge' && w.gaugeVariant === 'vehicle-status') {
    w.gaugeVariant = 'semi-arc';
  }

  if (w.type === 'slot-grid' && w.variant === 'maintenance') {
    w.variant = 'compact-row';
  }

  if (w.type === 'empty-state' && w.emptyStateVariant === 'event-center') {
    w.emptyStateVariant = 'minimal-center';
  }

  if (w.type === 'line-chart' && w.chartVariant === 'capacity-trend') {
    w.chartVariant = 'live-time-sync';
  }

  if (w.type === 'status-badge') {
    const field = String(w.valueField ?? '');
    if (field.includes('badge_label') || field.includes('trip_code')) {
      if (!w.mqttDataSourceId) w.mqttDataSourceId = 'default-mqtt';
      if (!w.mqttTopic) w.mqttTopic = 'v1/vtms/${vehicle_code}/operation/update';
      if (w.defaultLabel === '—' || w.defaultLabel === '-') w.defaultLabel = '';
    }
  }

  if (w.type === 'unit-telemetry-card') {
    if (w.cardVariant === 'vehicle-status') w.cardVariant = 'instrument-row';
    if (!w.healthStatusField) w.healthStatusField = 'overall_health';
    if (!w.badgeLabelField) w.badgeLabelField = 'badge_label';
    if (!w.badgeBgField) w.badgeBgField = 'trip_badge_bg';
    if (!w.badgeColorField) w.badgeColorField = 'trip_badge_color';
    if (!w.alertMessageField) w.alertMessageField = 'alert_message';
    if (!w.segmentLabelField) w.segmentLabelField = 'segment_label';
  }

  if (w.type === 'route-progress') {
    if (w.variant === 'dispatch-card') w.variant = 'detail-card';
    if (w.variant === 'maintenance-card') w.variant = 'service-card';
    if (!w.cardStationLabel) w.cardStationLabel = '站點';
    if (!w.cardMetricLabel) w.cardMetricLabel = 'ETA';
    if (!w.cardDepartLabel) w.cardDepartLabel = '開始';
    if (!w.cardEndLabel) w.cardEndLabel = '結束';
  }

  if (w.type === 'vehicle-alert-banner') {
    return {
      type: 'alert-banner',
      id: w.id as string,
      x: w.x as number,
      y: w.y as number,
      width: w.width as number,
      height: w.height as number,
      fontSize: (w.fontSize as number) ?? 10,
      fontFamily: 'system-ui, sans-serif',
      fontWeight: 'bold',
      color: '#fafafa',
      textAlign: 'center',
      borderRadius: 4,
      borderWidth: 0,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      textWrap: 'nowrap',
      contentPadding: '4px 8px',
      severityVarKey: (w.severityVarKey as string) ?? 'overall_health',
      triggerConditions: [
        {
          id: `migrated-${w.id}`,
          content: `{${(w.messageVarKey as string) ?? 'alert_message'}}`,
          textColor: '#fff7ed',
          backgroundColor: '#c2410c',
          borderColor: '#fb923c',
          displayMode: 'blink',
          startField: (w.messageVarKey as string) ?? 'alert_message',
          startMode: 'non-empty',
          endEnabled: false,
        },
      ],
    };
  }

  if (w.type === 'vehicle-container') {
    if (!w.actionIconRules) {
      w.actionIconRules = [];
    } else if ((w.actionIconRules as unknown[]).length > 0) {
      w.actionIconRules = migrateBehaviorActionRules(
        w.actionIconRules as import('../types').RouteActionIconRule[],
      );
    }
    if (w.behaviorOffsetX === undefined) w.behaviorOffsetX = 0;
    if (w.behaviorOffsetY === undefined) w.behaviorOffsetY = -28;
    if (w.behaviorIconSize === undefined) w.behaviorIconSize = 20;
    if (!w.mqttDataSourceId) w.mqttDataSourceId = 'default-mqtt';
    if (!w.mqttTopic) w.mqttTopic = 'v1/vtms/PMS01/operation/update';
  }

  return w as unknown as ChildWidget;
}
