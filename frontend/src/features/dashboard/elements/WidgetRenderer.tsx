import type { ChildWidget, AlertBannerWidget, VehicleAlertBannerWidget, VehicleContainerWidget } from '../types';
import { TextWidgetView }        from './TextWidget';
import { ImageWidgetView }       from './ImageWidget';
import { LineChartWidgetView }   from './LineChartWidget';
import { DatabaseWidgetView }    from './DatabaseWidget';
import { GaugeWidget }           from './GaugeWidget';
import { SlotGridWidget }        from './SlotGridWidget';
import { RouteProgressWidgetView } from './RouteProgressWidget';
import { ColorBlockWidgetView }  from './ColorBlockWidget';
import { StatusBadgeWidgetView } from './StatusBadgeWidget';
import { StatCardWidgetView }    from './StatCardWidget';
import { ProgressBarWidgetView } from './ProgressBarWidget';
import { ClockWidgetView }       from './ClockWidget';
import { EmptyStateWidgetView }  from './EmptyStateWidget';
import { SegmentBarWidgetView }  from './SegmentBarWidget';
import { BarChartWidgetView }    from './BarChartWidget';
import { MapCanvasWidgetView }   from './MapCanvasWidget';
import { UnitTelemetryCardWidgetView } from './UnitTelemetryCardWidget';
import { AlertBannerWidgetView } from './AlertBannerWidget';
import { VehicleContainerWidgetView } from './VehicleContainerWidgetView';
export function WidgetRenderer({
  widget,
  isSelected,
  editorScale,
  onPatchWidget,
}: {
  widget: ChildWidget;
  isSelected?: boolean;
  editorScale?: number;
  onPatchWidget?: (patch: Partial<ChildWidget>) => void;
}) {
  switch (widget.type) {
    case 'text':           return <TextWidgetView widget={widget} />;
    case 'image':          return <ImageWidgetView widget={widget} />;
    case 'line-chart':     return <LineChartWidgetView widget={widget} />;
    case 'database':       return <DatabaseWidgetView widget={widget} />;
    case 'gauge':          return <GaugeWidget widget={widget} />;
    case 'slot-grid':      return <SlotGridWidget widget={widget} />;
    case 'route-progress': return <RouteProgressWidgetView widget={widget} />;
    case 'color-block':    return <ColorBlockWidgetView widget={widget} />;
    case 'status-badge':   return <StatusBadgeWidgetView widget={widget} />;
    case 'stat-card':      return <StatCardWidgetView widget={widget} />;
    case 'progress-bar':   return <ProgressBarWidgetView widget={widget} />;
    case 'clock':          return <ClockWidgetView widget={widget} />;
    case 'empty-state':    return <EmptyStateWidgetView widget={widget} />;
    case 'segment-bar':    return <SegmentBarWidgetView widget={widget} />;
    case 'bar-chart':      return <BarChartWidgetView widget={widget} />;
    case 'map-canvas':     return <MapCanvasWidgetView widget={widget} />;
    case 'unit-telemetry-card': return <UnitTelemetryCardWidgetView widget={widget} />;
    case 'alert-banner': return <AlertBannerWidgetView widget={widget} />;
    case 'vehicle-container':
      return (
        <VehicleContainerWidgetView
          widget={widget}
          isSelected={isSelected}
          editorScale={editorScale}
          onPatchWidget={onPatchWidget as ((patch: Partial<VehicleContainerWidget>) => void) | undefined}
        />
      );
    case 'vehicle-alert-banner': {
      const legacy = widget as VehicleAlertBannerWidget;
      const mapped: AlertBannerWidget = {
        type: 'alert-banner',
        id: legacy.id,
        x: legacy.x,
        y: legacy.y,
        width: legacy.width,
        height: legacy.height,
        content: '{alert_message}',
        fontSize: legacy.fontSize ?? 10,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        color: '#fafafa',
        textAlign: 'center',
        borderRadius: 4,
        borderWidth: 0,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        icon: 'AlertCircle',
        textWrap: 'nowrap',
        contentPadding: '4px 8px',
        triggerConditions: [{
          id: 'rule-legacy',
          content: '{alert_message}',
          textColor: '#fafafa',
          backgroundColor: 'rgba(194,65,12,0.55)',
          borderColor: 'rgba(251,146,60,0.45)',
          displayMode: 'blink',
          startField: legacy.messageVarKey ?? 'alert_message',
          startMode: 'non-empty',
          endEnabled: false,
        }],
        severityVarKey: legacy.severityVarKey ?? 'overall_health',
      };
      return <AlertBannerWidgetView widget={mapped} />;
    }
  }
}


