import {
  collectWaypointIdsFromMapDocument,
  isNonPassengerWaypointId,
} from './station-alias';

/**
 * 乘客可見的只有停靠點。途經點（入口途經點、交叉軌道四個接口）是車輛必經的點位，
 * 不能出現在到站預測的站清單裡。
 */
const mapDocument = {
  areas: [
    {
      facilities: [
        { type: 'Waypoint', parameters: { waypointCode: 'charge_and_wash_waypoint' } },
        {
          type: 'Track',
          name: 'RailCross',
          parameters: {
            crossTrackPortals: {
              lt: { waypointCode: 'n2w_u2d_go_end', alias: '下行轉N2W正線終點' },
              lb: { waypointCode: 'n2w_u2d_back_start' },
              rt: { waypointCode: 'n2w_u2d_back_end' },
              rb: { waypointCode: ' n2w_u2d_go_start ' },
            },
          },
        },
        { type: 'DockingPoint', parameters: { stationId: 't3_u' } },
      ],
    },
  ],
};

describe('途經點不算乘客可見停靠點', () => {
  const ids = collectWaypointIdsFromMapDocument(mapDocument);

  it('收得到入口途經點與交叉軌道的四個接口（去掉前後空白）', () => {
    expect([...ids].sort()).toEqual([
      'charge_and_wash_waypoint',
      'n2w_u2d_back_end',
      'n2w_u2d_back_start',
      'n2w_u2d_go_end',
      'n2w_u2d_go_start',
    ]);
  });

  it('停靠點不在其中', () => {
    expect(ids.has('t3_u')).toBe(false);
    expect(isNonPassengerWaypointId('t3_u', ids)).toBe(false);
  });

  it('交叉軌道接口與入口途經點都排除', () => {
    expect(isNonPassengerWaypointId('n2w_u2d_back_end', ids)).toBe(true);
    expect(isNonPassengerWaypointId(' charge_and_wash_waypoint', ids)).toBe(true);
  });

  it('舊版虛擬渡線代號仍排除（舊班表資料可能還帶著）', () => {
    expect(isNonPassengerWaypointId('xo_1_a')).toBe(true);
    expect(isNonPassengerWaypointId('xowp:abc:a')).toBe(true);
  });

  it('沒有圖資時不誤殺任何一般代號', () => {
    expect(isNonPassengerWaypointId('n2w_u2d_back_end')).toBe(false);
    expect(collectWaypointIdsFromMapDocument(null).size).toBe(0);
  });
});
