import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nodeMatchesMoveCardCodes } from './moveCardShared';
import { resolveExitStationIdsForFacilityCodes } from './maintenanceFirstTripOrigins';

it('設施代號完整比對，不把 E10 當成 E1，也不依賴英文格式', () => {
  assert.equal(nodeMatchesMoveCardCodes({ id: 'node-10', label: 'E10' }, ['E1']), false);
  assert.equal(nodeMatchesMoveCardCodes({ id: 'node-E1', label: '其他格' }, ['E1']), false);
  assert.equal(nodeMatchesMoveCardCodes({ id: 'node-1', label: '中文停車格' }, ['中文停車格']), true);
  assert.equal(nodeMatchesMoveCardCodes({ id: 'node-1', label: '已改名' }, ['node-1']), true);
  assert.deepEqual(resolveExitStationIdsForFacilityCodes([
    { stationId: 's', label: 's', deadheadSeconds: 0, facilityNodeIds: ['node-10'], facilityLabels: ['E10'] },
  ], ['E1']), []);
});
