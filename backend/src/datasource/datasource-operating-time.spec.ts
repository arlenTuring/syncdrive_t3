import { substituteOperatingTime } from './datasource.service';

describe('儀表板查詢的營運時間', () => {
  it('計畫時刻跟營運時間比；換成數值與營運日字串', () => {
    const sql = `SELECT 1 FROM operation_orders o
      WHERE o.planned_start <= operating_now_ms()
        AND o.planned_start >= operating_day_start_ms()
        AND o.payload->>'operating_day' = operating_day()
        AND (o.payload->>'updated_at')::bigint >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000`;
    const out = substituteOperatingTime(sql, 1791238000123.4, 1791216000000, '2026-10-06');
    expect(out).toContain('o.planned_start <= (1791238000123::bigint)');
    expect(out).toContain('o.planned_start >= (1791216000000::bigint)');
    expect(out).toContain("= '2026-10-06'");
    // 訊息新鮮度仍用實際時間
    expect(out).toContain('EXTRACT(EPOCH FROM now())');
  });

  it('營運日格式不對就拒絕（不讓任意字串進 SQL）', () => {
    expect(() => substituteOperatingTime('SELECT operating_day()', 0, 0, "x' OR '1'='1")).toThrow();
  });
});
