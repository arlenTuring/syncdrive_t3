import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventPhrase, formatCountdown, stationEtaUrl } from './StationEtaWidget';

describe('到站／出發清單', () => {
  it('倒數格式：幾分幾秒；一小時以上幾時幾分', () => {
    assert.equal(formatCountdown(83_000), '1分23秒');
    assert.equal(formatCountdown(5_000), '0分05秒');
    assert.equal(formatCountdown(3_725_000), '1時02分');
  });

  it('到站顯示幾分幾秒到站、出發顯示幾分幾秒出發；時間到了是即將到站／即將出發', () => {
    const now = 1_000_000;
    assert.equal(eventPhrase({ event: 'arrive', at: now + 95_000, at_station: false }, now), '1分35秒到站');
    assert.equal(eventPhrase({ event: 'depart', at: now + 42_000, at_station: true }, now), '0分42秒出發');
    assert.equal(eventPhrase({ event: 'arrive', at: now - 1_000, at_station: false }, now), '即將到站');
    assert.equal(eventPhrase({ event: 'depart', at: now, at_station: true }, now), '停靠中，即將出發');
  });

  it('網址：到站、出發的站點各自帶上；舊設定沒有 events 只列到站', () => {
    const url = stationEtaUrl({
      dataUrl: '/syncdrive-api/operation-metrics/station-eta',
      limit: 3,
      stations: [
        { stationId: 'n2w_d_end', label: '上行停靠', events: ['arrive'] },
        { stationId: 'n2w_d_start', label: '下行出發', events: ['depart'] },
        { stationId: 't3_u', label: '上行', events: ['arrive', 'depart'] },
        { stationId: 's2w_d_end', label: '下行停靠' },
      ],
    });
    assert.equal(url, '/syncdrive-api/operation-metrics/station-eta?arrive=n2w_d_end,t3_u,s2w_d_end&depart=n2w_d_start,t3_u&limit=3');
  });
});
