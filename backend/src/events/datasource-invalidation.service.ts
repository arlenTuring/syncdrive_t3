import { Injectable } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/** 與前端 inferInvalidateTagsFromSql 對齊的失效標籤 */
export const DS_TAGS = {
  OPERATION_ORDERS: 'table:operation_orders',
  MAINLINE_SHIFTS: 'domain:mainline_shifts',
  MAINTENANCE_SHIFTS: 'domain:maintenance_shifts',
  SHIFT_CENTER: 'domain:shift_center',
  EVENT_CENTER: 'domain:event_center',
  VEHICLE_MONITOR: 'domain:vehicle_monitor',
  MAINTENANCE_SLOTS: 'domain:maintenance_slots',
  VEHICLE_DISTRIBUTION: 'domain:vehicle_distribution',
  CAPACITY_TREND: 'domain:capacity_trend',
  SECURITY_EVENTS: 'table:security_event_log',
  SLOT_STATUS: 'table:slot_status',
} as const;

export type DatasourceInvalidatePayload = {
  tags: string[];
  at: number;
  reason?: string;
};

@Injectable()
export class DatasourceInvalidationService {
  constructor(private readonly eventsGateway: EventsGateway) {}

  emit(tags: string[], reason?: string): void {
    const unique = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const payload: DatasourceInvalidatePayload = {
      tags: unique,
      at: Date.now(),
      ...(reason ? { reason } : {}),
    };
    this.eventsGateway.broadcastDatasourceInvalidate(payload);
  }

  emitOrderLifecycle(vehicleCode?: string, extraTags: string[] = []): void {
    const tags = [
      DS_TAGS.OPERATION_ORDERS,
      DS_TAGS.MAINLINE_SHIFTS,
      DS_TAGS.MAINTENANCE_SHIFTS,
      DS_TAGS.SHIFT_CENTER,
      DS_TAGS.VEHICLE_MONITOR,
      DS_TAGS.VEHICLE_DISTRIBUTION,
      ...extraTags,
    ];
    if (vehicleCode) {
      tags.push(`vehicle:${String(vehicleCode).trim().toUpperCase()}`);
    }
    this.emit(tags, 'order_lifecycle');
  }

  emitEventCenter(): void {
    this.emit([DS_TAGS.EVENT_CENTER, DS_TAGS.SECURITY_EVENTS, DS_TAGS.SHIFT_CENTER], 'security_event');
  }

  emitMaintenanceSlots(): void {
    this.emit(
      [DS_TAGS.SLOT_STATUS, DS_TAGS.MAINTENANCE_SLOTS, DS_TAGS.MAINTENANCE_SHIFTS, DS_TAGS.VEHICLE_DISTRIBUTION],
      'slot_status',
    );
  }
}
