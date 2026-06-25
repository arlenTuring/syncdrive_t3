export function readOrderStatus(
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  mqttPayload?: Record<string, unknown> | null,
): string {
  const mqttOrder = mqttPayload?.order_status;
  if (mqttOrder !== null && mqttOrder !== undefined && mqttOrder !== '') {
    const normalized = String(mqttOrder).toUpperCase();
    if (normalized === 'PROCESSING' || normalized === 'PENDING' || normalized === 'FAULTED') {
      return normalized;
    }
  }

  const phase = String(mqttPayload?.vehicle_phase ?? '').toUpperCase();
  if (phase === 'FAULTED') return 'FAULTED';
  if (
    phase === 'TRANSITING'
    || phase === 'DWELLING'
    || phase === 'DOCKING'
    || phase === 'CHARGING'
    || phase === 'YARD_DWELLING'
  ) {
    return 'PROCESSING';
  }
  if (phase === 'AWAITING_DEPARTURE') return 'PENDING';

  const raw = variables.order_status ?? sqlRow?.order_status;
  if (raw !== null && raw !== undefined && raw !== '') {
    return String(raw).toUpperCase();
  }
  const label = String(variables.status_label ?? sqlRow?.status_label ?? '');
  if (label === '待發') return 'PENDING';
  if (label === '故障') return 'FAULTED';
  if (label === '準時' || label === '延誤') return 'PROCESSING';
  return '';
}
