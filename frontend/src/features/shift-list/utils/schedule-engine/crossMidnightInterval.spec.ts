import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildIntervalEndSecondByDepartureStart,
  generateDeparturesFromHeadway,
} from './generateDepartures';

/**
 * 時段本身可以跨午夜（23:00–01:00）。
 *
 * 引擎原本是「<code>endMinute &lt;= startMinute</code> 就 continue」——跨午夜的
 * 時段會被<strong>整段安靜跳過</strong>：使用者畫得出時段，班表卻少掉那一段的
 * 班次，而且完全不報錯。這幾則就是盯這件事。
 */
describe('跨午夜時段的發車脈衝', () => {
  const intervals = [
    {
      id: 'iv-night',
      attributeId: 'attr-night',
      name: '跨夜',
      startTime: '23:00',
      endTime: '01:00',
      isDraft: false,
    },
  ] as never as Parameters<typeof generateDeparturesFromHeadway>[0]['intervals'];

  const attributes = [
    {
      id: 'attr-night',
      name: '夜間',
      color: '#ffffff',
      headwaySeconds: 1800,
      capacityPphpd: 0,
      isDraft: false,
    },
  ] as never as Parameters<typeof generateDeparturesFromHeadway>[0]['attributes'];

  it('午夜前後兩段都要發車', () => {
    const departures = generateDeparturesFromHeadway({ intervals, attributes });
    const clock = departures
      .map((departure) => departure.startSecond / 60)
      .sort((a, b) => a - b)
      .map((minute) =>
        `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.round(minute % 60)).padStart(2, '0')}`);
    assert.deepEqual(clock, ['00:00', '00:30', '23:00', '23:30']);
  });

  it('每一班的「所屬時段結束秒」要看它落在哪一段，不是整個時段共用一個', () => {
    const departures = generateDeparturesFromHeadway({ intervals, attributes });
    const endByStart = buildIntervalEndSecondByDepartureStart(departures, intervals);
    // 23:30 那班屬於日尾那段 → 界線是 24:00
    assert.equal(endByStart.get(23 * 3600 + 1800), 24 * 3600);
    // 00:30 那班屬於日頭那段 → 界線是 01:00
    assert.equal(endByStart.get(1800), 3600);
  });

  it('沒跨午夜的時段行為不變', () => {
    const plain = [
      { ...(intervals[0] as never as Record<string, unknown>), startTime: '08:00', endTime: '09:00' },
    ] as never as typeof intervals;
    const departures = generateDeparturesFromHeadway({ intervals: plain, attributes });
    assert.equal(departures.length, 2);
    assert.equal(departures[0]!.startSecond, 8 * 3600);
    assert.equal(
      buildIntervalEndSecondByDepartureStart(departures, plain).get(8 * 3600),
      9 * 3600,
    );
  });
});
