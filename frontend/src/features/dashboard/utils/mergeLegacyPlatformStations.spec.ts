import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChildWidget } from '../types';
import { mergeLegacyPlatformStations } from './mergeLegacyPlatformStations';

const card = (stations: unknown[]) => ({ id: 'c', type: 'station-eta', title: 'N2W 進站動態', stations } as unknown as ChildWidget);

describe('進站動態：舊的兩點月台代號合回一個月台', () => {
  it('xxx_end（到站）與 xxx_start（發車）合成 xxx，同時列到站與發車', () => {
    const result = mergeLegacyPlatformStations(card([
      { stationId: 'n2w_d_end', label: 'n2w_d_end', events: ['arrive'] },
      { stationId: 'n2w_u_end', label: 'n2w_u_end', events: ['arrive'] },
      { stationId: 'n2w_d_start', label: 'n2w_d_start', events: ['depart'] },
      { stationId: 'n2w_u_start', label: 'n2w_u_start', events: ['depart'] },
    ])) as unknown as { stations: unknown[] };
    assert.deepEqual(result.stations, [
      { stationId: 'n2w_d', label: 'n2w_d', events: ['arrive', 'depart'] },
      { stationId: 'n2w_u', label: 'n2w_u', events: ['arrive', 'depart'] },
    ]);
    // 再跑一次不變
    assert.equal(mergeLegacyPlatformStations(result as unknown as ChildWidget), result);
  });

  it('沒有舊代號的卡片原樣回傳；自訂名稱保留', () => {
    const t3 = card([{ stationId: 't3_u', label: 't3_u', events: ['arrive', 'depart'] }]);
    assert.equal(mergeLegacyPlatformStations(t3), t3);
    const named = mergeLegacyPlatformStations(card([{ stationId: 's2w_d_end', label: 'S2W 下行' }])) as unknown as { stations: unknown[] };
    assert.deepEqual(named.stations, [{ stationId: 's2w_d', label: 'S2W 下行', events: ['arrive'] }]);
  });
});
