import type { ColorBlockWidget } from '../types';
import { useVariables, interpolateVariables } from '../VariableContext';
import { getSeverityStyle } from '../constants/severityTheme';
import { useWidgetData } from './useWidgetData';
import { useMqttData } from './useMqttData';
import { HEALTH_STATUS_BORDER, type HealthStatus } from '../constants/healthStatusTheme';
import { resolveMqttFieldValue } from '../utils/mqttFieldResolve';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

export function ColorBlockWidgetView({ widget }: { widget: ColorBlockWidget }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const variables = useVariables();
  const sqlData = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
  });
  const severityFromSql = widget.severityStripColor && widget.sqlQuery
    ? sqlData.data[0]?.severity ?? sqlData.data[0]?.value
    : undefined;
  const severityStyle = widget.severityStripColor
    ? getSeverityStyle(severityFromSql ?? variables.severity)
    : null;

  const resolvedMqttTopic = widget.mqttTopic
    ? interpolateVariables(widget.mqttTopic, variables)
    : undefined;

  const mqttData = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: resolvedMqttTopic,
    mqttValuePath: widget.mqttValuePath,
  });

  let borderFromVar = widget.borderColor;
  const healthField = widget.healthFieldForBorder?.trim();
  if (widget.bindBorderFromHealthField && healthField && mqttData.data !== null) {
    const health = String(
      resolveMqttFieldValue(mqttData.data, widget.mqttValuePath || healthField) ?? '',
    ).toUpperCase() as HealthStatus;
    borderFromVar = HEALTH_STATUS_BORDER[health] ?? widget.borderColor;
  } else if (widget.bindBorderColorVar) {
    borderFromVar = String(variables[widget.bindBorderColorVar] ?? widget.borderColor);
  }

  const hasLiveSeverity = widget.severityStripColor
    && (severityFromSql !== undefined || variables.severity !== undefined);
  const isEditPreview = shouldShowEditPreview(
    isEditMode,
    hasBinding || !!widget.severityStripColor,
    hasLiveSeverity || !widget.severityStripColor,
  );

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'color-block' })}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: severityStyle?.stripBg ?? widget.backgroundColor,
          borderRadius: widget.borderRadius,
          border: `${widget.borderWidth}px solid ${borderFromVar}`,
          opacity: widget.opacity / 100,
          boxSizing: 'border-box',
        }}
      />
    </WidgetEditPreviewOutline>
  );
}
