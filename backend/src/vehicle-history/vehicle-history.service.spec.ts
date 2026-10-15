import { BadRequestException } from '@nestjs/common';
import { compareSeq, MAX_SEQ, parseSeq, parseZonedDateTime } from './history-cursor';
import { mergeRanges, VehicleHistoryService } from './vehicle-history.service';

type Handler = (sql: string, params: unknown[]) => unknown[] | undefined;

const VEHICLE_A = { id: '11111111-1111-4111-8111-111111111111', vehicle_code: 'PMS01', display_name: '一號車', is_active: true };
const VEHICLE_B = { id: '22222222-2222-4222-8222-222222222222', vehicle_code: 'PMS02', display_name: '二號車', is_active: false };
const VEHICLE_C = { id: '55555555-5555-4555-8555-555555555555', vehicle_code: 'PMS05', display_name: '五號車', is_active: true };
const REGISTRY = [VEHICLE_A, VEHICLE_B, VEHICLE_C];
const registry: Handler = (sql, params) => {
  if (sql.includes('FROM vehicles WHERE id = $1')) return REGISTRY.filter((row) => row.id === params[0]);
  if (sql.includes('FROM vehicles WHERE vehicle_code = ANY')) return REGISTRY.filter((row) => (params[0] as string[]).includes(row.vehicle_code));
  return undefined;
};

function serviceWith(handlers: Handler[]) {
  handlers = [registry, ...handlers];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const handler of handlers) {
        const result = handler(sql, params);
        if (result !== undefined) return result;
      }
      return [];
    }),
  };
  return { service: new VehicleHistoryService(dataSource as never), calls };
}

describe('history cursor', () => {
  it('keeps bigint sequence numbers as exact strings beyond 2^53', () => {
    const big = '9007199254740993';
    expect(parseSeq(big)).toBe(big);
    expect(Number(big)).not.toBe(9007199254740993n.toString());
    expect(compareSeq('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    expect(compareSeq('10', '9')).toBeGreaterThan(0);
    expect(parseSeq('')).toBeNull();
    expect(() => parseSeq('1e5')).toThrow(BadRequestException);
    expect(() => parseSeq('99999999999999999999')).toThrow(BadRequestException);
    expect(parseSeq(MAX_SEQ)).toBe(MAX_SEQ);
  });

  it('requires an explicit time zone on date-times', () => {
    expect(parseZonedDateTime('2026-10-15T08:00:00+08:00', 'from')).toBe(Date.UTC(2026, 9, 15, 0, 0, 0));
    expect(parseZonedDateTime('2026-10-15T00:00:00Z', 'from')).toBe(Date.UTC(2026, 9, 15, 0, 0, 0));
    expect(() => parseZonedDateTime('2026-10-15T08:00:00', 'from')).toThrow(BadRequestException);
  });

  it('merges overlapping recorded ranges', () => {
    expect(mergeRanges([{ from_real: 5, to_real: 8 }, { from_real: 1, to_real: 3 }, { from_real: 2, to_real: 4 }])).toEqual([
      { from_real: 1, to_real: 4 },
      { from_real: 5, to_real: 8 },
    ]);
  });
});

describe('VehicleHistoryService', () => {
  it('reports time before the feature existed as not recorded, and a stop between segments as a restart gap', async () => {
    const { service } = serviceWith([
      (sql) =>
        sql.includes('FROM vehicle_history_segments')
          ? [
              { started_real: '2000', last_alive_real: '4000', ended_real: '4000', status: 'interrupted' },
              { started_real: '6000', last_alive_real: '9000', ended_real: '9000', status: 'closed' },
            ]
          : undefined,
      (sql) => (sql.includes('FROM vehicle_history_gaps') ? [{ from_real: '7000', to_real: '7100', from_operating: null, to_operating: null, reason: 'write_failed', count: 3, detail: 'db' }] : undefined),
    ]);
    const coverage = await service.coverage(1000, 10_000);
    expect(coverage.state).toBe('partial');
    expect(coverage.recorded).toEqual([{ from_real: 2000, to_real: 4000 }, { from_real: 6000, to_real: 9000 }]);
    expect(coverage.gaps.map((gap) => [gap.reason, gap.from_real, gap.to_real])).toEqual([
      ['not_recorded', 1000, 2000],
      ['backend_restart', 4000, 6000],
      ['write_failed', 7000, 7100],
      ['backend_restart', 9000, 10_000],
    ]);
  });

  it('says none when nothing was recorded in the range (no data made up from the current state)', async () => {
    const { service } = serviceWith([]);
    const coverage = await service.coverage(1000, 2000);
    expect(coverage.state).toBe('none');
    expect(coverage.gaps).toEqual([expect.objectContaining({ reason: 'not_recorded', from_real: 1000, to_real: 2000 })]);
  });

  it('clips persisted cleanup gaps to the requested range', async () => {
    const { service } = serviceWith([
      (sql) =>
        sql.includes('FROM vehicle_history_gaps')
          ? [{ from_real: '0', to_real: '1500', from_operating: null, to_operating: null, reason: 'retention_cleanup', count: 10, detail: null }]
          : undefined,
    ]);
    const coverage = await service.coverage(1000, 2000);
    expect(coverage.gaps).toContainEqual(expect.objectContaining({ reason: 'retention_cleanup', from_real: 1000, to_real: 1500 }));
    expect(coverage.gaps.every((gap) => gap.from_real >= 1000 && gap.to_real <= 2000)).toBe(true);
  });

  it('uses actual vehicle frames as recording evidence when old segment metadata is missing', async () => {
    const { service } = serviceWith([]);
    const coverage = await service.coverage(1000, 2000, 'PMS01', { first_real: 1200, last_real: 1800 });
    expect(coverage.state).toBe('partial');
    expect(coverage.recorded).toEqual([{ from_real: 1200, to_real: 1800 }]);
    expect(coverage.gaps.map((gap) => [gap.from_real, gap.to_real])).toEqual([
      [1000, 1200],
      [1800, 2000],
    ]);
  });

  it('rejects an end before the start and ranges that are too long', async () => {
    const { service } = serviceWith([]);
    await expect(service.resolveRange({ vehicle_id: VEHICLE_A.id, from: '2026-10-15T10:00:00+08:00', to: '2026-10-15T09:00:00+08:00' })).rejects.toThrow('結束時間必須晚於開始時間');
    await expect(service.resolveRange({ vehicle_id: VEHICLE_A.id, from: '2026-10-14T00:00:00+08:00', to: '2026-10-15T00:00:00+08:00' })).rejects.toThrow('一次最多查');
  });

  it('resolves a time range from every saved frame for the vehicle, without consulting shift or order boundaries', async () => {
    const from = Date.parse('2026-10-15T08:00:00+08:00');
    const to = Date.parse('2026-10-15T09:00:00+08:00');
    const { service, calls } = serviceWith([
      (sql) =>
        sql.includes('count(*) AS count')
          ? [{ count: '2', first: String(from + 1000), last: String(to - 1000) }]
          : undefined,
    ]);
    const result = await service.resolveRange({
      vehicle_id: VEHICLE_A.id,
      from: '2026-10-15T08:00:00+08:00',
      to: '2026-10-15T09:00:00+08:00',
    });
    expect(result).toMatchObject({
      range_basis: 'vehicle_received_at',
      vehicle_records: { count: 2, first_real: from + 1000, last_real: to - 1000 },
    });
    expect(calls.some((call) => call.sql.includes('FROM operation_orders'))).toBe(false);
    const count = calls.find((call) => call.sql.includes('count(*) AS count'))!;
    expect(count.sql).toContain('vehicle_code = $1');
    expect(count.sql).toContain('received_at BETWEEN $2 AND $3');
    expect(count.params.slice(0, 3)).toEqual(['PMS01', from, to]);
  });

  const order = (createdAt: string, extra: Record<string, unknown> = {}) => ({
    order_id: '261015-E021830',
    trip_code: 'E021830',
    vehicle_code: 'PMS02',
    status: 'END',
    created_at: createdAt,
    completed_at: null,
    payload: { actual_started_at: Number(createdAt) + 1000, vehicle_progress_at: { END: Number(createdAt) + 61_000 }, ...extra },
  });

  it('tells two executions of the same order id apart by creation time, and asks for the full code when ambiguous', async () => {
    const earlier = { payload: { ...order('1791000000000').payload, created_at: '1791000000000', status: 'END', trip_code: 'E021830', vehicle_code: 'PMS05' }, received_at: '1791000005000' };
    const { service } = serviceWith([
      (sql) => (sql.includes('FROM operation_orders') ? [order('1791000900000')] : undefined),
      (sql) => (sql.includes("stream = 'order' AND order_id") ? [earlier] : undefined),
      (sql) => (sql.includes('FROM vehicle_history_segments') ? [{ started_real: '0', last_alive_real: '9999999999999', ended_real: '9999999999999', status: 'closed' }] : undefined),
    ]);
    const ambiguous = await service.resolveShift('261015-E021830');
    expect(ambiguous.state).toBe('ambiguous');
    expect(ambiguous.candidates?.map((item) => item.code)).toEqual(['261015-E021830@1791000000000', '261015-E021830@1791000900000']);

    // 同一個訂單號、不同次執行：各自對到自己的車與時間範圍，不混用
    const exact = await service.resolveShift('261015-E021830@1791000000000');
    expect(exact).toMatchObject({ state: 'complete', code: '261015-E021830@1791000000000', vehicle_code: 'PMS05', window: { from_real: 1791000001000, to_real: 1791000061000 } });
    const current = await service.resolveShift('261015-E021830@1791000900000');
    expect(current).toMatchObject({ state: 'complete', vehicle_code: 'PMS02', window: { from_real: 1791000901000, to_real: 1791000961000 } });
  });

  it('does not fake a trajectory for a shift that has not started', async () => {
    const { service } = serviceWith([(sql) => (sql.includes('FROM operation_orders') ? [{ ...order('1791000900000'), status: 'PENDING', payload: {} }] : undefined)]);
    const result = await service.resolveShift('261015-E021830@1791000900000');
    expect(result).toMatchObject({ state: 'not_started', window: null });
  });

  it('says no history when the shift ran but nothing was recorded for it', async () => {
    const { service } = serviceWith([(sql) => (sql.includes('FROM operation_orders') ? [order('1791000900000')] : undefined)]);
    const result = await service.resolveShift('261015-E021830@1791000900000');
    expect(result.state).toBe('no_history');
  });

  it('falls back to the first and last recorded operation reports when the start or end was not reported, and says so', async () => {
    const { service } = serviceWith([
      (sql) => (sql.includes('FROM operation_orders') ? [{ ...order('1791000900000'), status: 'CANCELLED', payload: {} }] : undefined),
      (sql) => (sql.includes("stream = 'operation'") ? [{ first: '1791000903000', last: '1791000921000' }] : undefined),
      (sql) => (sql.includes('FROM vehicle_history_segments') ? [{ started_real: '0', last_alive_real: '9999999999999', ended_real: '9999999999999', status: 'closed' }] : undefined),
    ]);
    const result = await service.resolveShift('261015-E021830@1791000900000');
    expect(result).toMatchObject({
      state: 'complete',
      window: { from_real: 1791000903000, to_real: 1791000921000, ongoing: false },
      range_basis: { from: 'first_operation_report', to: 'last_operation_report' },
    });
  });

  it('builds the start snapshot only from data at or before the cursor (same millisecond up to the given sequence)', async () => {
    const { service, calls } = serviceWith([
      (sql) => (sql.includes('FROM vehicle_history_stream_keys') ? [{ stream_key: 'telemetry|PMS01', stream: 'telemetry' }, { stream_key: 'map|active', stream: 'map' }] : undefined),
    ]);
    await service.snapshot({ vehicle_id: VEHICLE_A.id, scope: 'background', at: '100000', seq: '42' });
    const lateral = calls.find((call) => call.sql.includes('CROSS JOIN LATERAL'))!;
    expect(lateral.sql).toContain('(received_at, seq) <= ($3::bigint, $4::bigint)');
    expect(lateral.params[2]).toBe(100_000);
    expect(lateral.params[3]).toBe('42');
    // 地圖參照不限往回距離；車輛串流有往回上限（過期規則另在前端套用）
    expect(lateral.params[1]).toEqual([100_000 - 6 * 60 * 60_000, 0]);
  });

  it('requires a registered vehicle on every investigation call, by stable id only', async () => {
    const { service } = serviceWith([]);
    await expect(service.resolveRange({ from: '2026-10-15T08:00:00+08:00', to: '2026-10-15T09:00:00+08:00' })).rejects.toThrow('請指定調查載具');
    await expect(service.frames({ vehicle_id: 'PMS01', from: '1', to: '2' })).rejects.toThrow('識別格式不正確');
    await expect(service.neighbor({ vehicle_id: '33333333-3333-4333-8333-333333333333', at: '1', dir: 'next' })).rejects.toThrow('找不到這台載具');
    // 停用的車仍可調查
    expect(await service.requireVehicle(VEHICLE_B.id)).toMatchObject({ vehicle_code: 'PMS02', is_active: false });
  });

  it('keeps vehicles apart in its identity cache', async () => {
    const { service } = serviceWith([]);
    expect((await service.requireVehicle(VEHICLE_A.id)).vehicle_code).toBe('PMS01');
    expect((await service.requireVehicle(VEHICLE_B.id)).vehicle_code).toBe('PMS02');
    expect((await service.requireVehicle(VEHICLE_A.id)).vehicle_code).toBe('PMS01');
  });

  it('filters frames by the investigated vehicle before applying the page limit', async () => {
    const { service, calls } = serviceWith([]);
    await service.frames({ vehicle_id: VEHICLE_A.id, from: '1000', to: '2000', limit: '5' });
    const call = calls.find((item) => item.sql.includes('FROM vehicle_history_frames'))!;
    // 篩選與上限在同一個查詢：WHERE 先排除其他車，LIMIT 才算筆數
    expect(call.sql).toMatch(/vehicle_code = \$5 AND stream IN \('telemetry','operation','health','event','command_ack','order','order_action','order_route'\)[\s\S]*LIMIT \$4/);
    expect(call.sql).not.toContain("'map'");
    expect(call.params[3]).toBe(6);
    expect(call.params[4]).toBe('PMS01');
  });

  it('gives the background everything except the investigated vehicle', async () => {
    const { service, calls } = serviceWith([]);
    await service.frames({ vehicle_id: VEHICLE_A.id, scope: 'background', from: '1000', to: '2000' });
    const call = calls.find((item) => item.sql.includes('FROM vehicle_history_frames'))!;
    expect(call.sql).toContain('vehicle_code IS DISTINCT FROM $5');
    await expect(service.frames({ vehicle_id: VEHICLE_A.id, scope: 'everything', from: '1', to: '2' })).rejects.toThrow('scope');
  });

  it('steps only through the investigated vehicle records', async () => {
    const { service, calls } = serviceWith([]);
    await service.neighbor({ vehicle_id: VEHICLE_A.id, at: '1500', seq: '7', dir: 'prev', min: '1000', max: '2000' });
    const call = calls.find((item) => item.sql.includes('FROM vehicle_history_frames'))!;
    expect(call.sql).toContain('vehicle_code = $4 AND stream = ANY($5::text[])');
    expect(call.params).toEqual([1500, '7', 1000, 'PMS01', expect.arrayContaining(['telemetry', 'order_action'])]);
    expect(call.params[4]).not.toContain('map');
  });

  it('builds the vehicle start snapshot from its own keys, orders it held at the time, and map references as a base only', async () => {
    const { service, calls } = serviceWith([
      (sql) => (sql.includes("stream IN ('order','order_action')") ? [{ stream_key: 'order|A1', stream: 'order' }] : undefined),
    ]);
    await service.snapshot({ vehicle_id: VEHICLE_A.id, at: '5000' });
    const lateral = calls.find((call) => call.sql.includes('CROSS JOIN LATERAL'))!;
    expect(lateral.params[0]).toEqual(['telemetry|PMS01', 'operation|PMS01', 'health|PMS01', 'event|PMS01', 'command_ack|PMS01', 'order|A1', 'map|active', 'model|active', 'clock|run']);
    expect(lateral.sql).toContain("OR stream IN ('map','model','clock')");
    expect(lateral.params[4]).toBe('PMS01');
  });

  const shiftOrder = order('1791000900000');
  const shiftHandlers = (frames: Array<{ vehicle_code: string; records: string }>): Handler[] => [
    (sql) => (sql.includes('FROM operation_orders') ? [{ ...shiftOrder, vehicle_code: 'PMS01' }] : undefined),
    (sql) => (sql.includes('GROUP BY vehicle_code') ? frames : undefined),
    (sql) => (sql.includes('FROM vehicle_history_segments') ? [{ started_real: '0', last_alive_real: '9999999999999', ended_real: '9999999999999', status: 'closed' }] : undefined),
  ];

  it('fixes the vehicle that actually ran the shift', async () => {
    const { service } = serviceWith(shiftHandlers([{ vehicle_code: 'PMS01', records: '40' }]));
    const result = await service.resolveShift('261015-E021830@1791000900000');
    expect(result).toMatchObject({ state: 'complete', vehicle: { id: VEHICLE_A.id, vehicle_code: 'PMS01' } });
  });

  it('asks which vehicle to investigate when the execution involved several, instead of picking the first', async () => {
    const { service } = serviceWith(shiftHandlers([{ vehicle_code: 'PMS01', records: '40' }, { vehicle_code: 'PMS02', records: '12' }]));
    const result = await service.resolveShift('261015-E021830@1791000900000');
    expect(result).toMatchObject({ state: 'multi_vehicle', vehicle: null, window: null });
    expect(result.vehicle_candidates?.map((item) => item.vehicle_code)).toEqual(['PMS01', 'PMS02']);
    const chosen = await service.resolveShift('261015-E021830@1791000900000', VEHICLE_B.id);
    expect(chosen).toMatchObject({ vehicle: { vehicle_code: 'PMS02' } });
  });

  it('refuses a vehicle that did not take part in the execution', async () => {
    const { service } = serviceWith(shiftHandlers([{ vehicle_code: 'PMS01', records: '40' }]));
    await expect(service.resolveShift('261015-E021830@1791000900000', VEHICLE_B.id)).rejects.toThrow('沒有參與');
  });
});
