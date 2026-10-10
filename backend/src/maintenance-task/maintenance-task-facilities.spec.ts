import {
  buildFacilityIndex,
  resolveTaskFacilities,
} from './maintenance-task-facilities';

const map = {
  areas: [
    {
      facilities: [
        {
          id: '091',
          type: 'DockingPoint',
          customName: 'NW下發1',
          parameters: { stationId: 'n2w_d_start' },
        },
        {
          id: '093',
          type: 'DockingPoint',
          customName: 'NW下發2',
          parameters: { stationId: 'n2w_u_start' },
        },
        { id: '132', type: 'Facility', customName: 'D1', parameters: {} },
        { id: '145', type: 'Facility', customName: 'M1', parameters: {} },
      ],
    },
  ],
};
const legacy = [
  { name: 'N2W下行出發', stationId: 'n2w_d_start' },
  { name: '[備用]N2W下行出發', stationId: 'n2w_u_start' },
  { name: 'N2W下行出發', stationId: 'station_2' }, // 另一張圖的站點 ID，這張圖沒有：不影響
];
const body = (rows: Array<Record<string, unknown>>) => ({
  mobile: { stepEnabled: true, equipmentRows: rows },
});

describe('maintenance task facilities follow map facility ids', () => {
  const index = buildFacilityIndex('map-a', map, legacy);

  it('fills ids for legacy rows (current names and recorded old station names) and shows current names', () => {
    const { body: next, unresolved } = resolveTaskFacilities(
      body([
        { id: 'r1', mapCode: 'M1' },
        { id: 'r2', mapCode: 'D1' },
        { id: 'r3', mapCode: '[備用]N2W下行出發' },
        { id: 'r4', mapCode: 'N2W下行出發' },
      ]),
      index,
    );
    expect(next.mapId).toBe('map-a');
    expect((next.mobile as { equipmentRows: unknown[] }).equipmentRows).toEqual(
      [
        { id: 'r1', equipmentId: '145', mapCode: 'M1' },
        { id: 'r2', equipmentId: '132', mapCode: 'D1' },
        { id: 'r3', equipmentId: '093', mapCode: 'NW下發2' },
        { id: 'r4', equipmentId: '091', mapCode: 'NW下發1' },
      ],
    );
    expect(unresolved).toEqual([]);
  });

  it('a renamed facility keeps its id and shows the new name', () => {
    const renamed = buildFacilityIndex('map-a', {
      areas: [
        {
          facilities: [
            {
              id: '093',
              type: 'DockingPoint',
              customName: '北站候車',
              parameters: { stationId: 'n2w_u_start' },
            },
          ],
        },
      ],
    });
    const { body: next } = resolveTaskFacilities(
      body([{ id: 'r', equipmentId: '093', mapCode: 'NW下發2' }]),
      renamed,
    );
    expect((next.mobile as { equipmentRows: unknown[] }).equipmentRows).toEqual(
      [{ id: 'r', equipmentId: '093', mapCode: '北站候車' }],
    );
  });

  it('never re-points a row: missing facility stays as-is and is reported', () => {
    const { body: next, unresolved } = resolveTaskFacilities(
      body([
        { id: 'r', equipmentId: '999', mapCode: 'X9' },
        { id: 's', mapCode: '不存在的站' },
        { id: 't', mapCode: 'unspecified' },
      ]),
      index,
    );
    const rows = (
      next.mobile as { equipmentRows: Array<Record<string, unknown>> }
    ).equipmentRows;
    expect(rows[0]).toMatchObject({
      equipmentId: '999',
      mapCode: 'X9',
      unresolved: true,
    });
    expect(rows[1]).toMatchObject({ mapCode: '不存在的站', unresolved: true });
    expect(rows[2]).toEqual({ id: 't', mapCode: 'unspecified' });
    expect(unresolved.map((u) => u.mapCode)).toEqual(['X9', '不存在的站']);
  });

  it('the read-only unresolved flag is not written back on save', () => {
    const { body: next } = resolveTaskFacilities(
      body([{ id: 's', mapCode: 'H1', unresolved: true }]),
      index,
      { annotate: false },
    );
    expect((next.mobile as { equipmentRows: unknown[] }).equipmentRows).toEqual(
      [{ id: 's', mapCode: 'H1' }],
    );
  });

  it('ambiguous names are not guessed', () => {
    const dup = buildFacilityIndex('map-a', {
      areas: [
        {
          facilities: [
            { id: 'a', type: 'Facility', customName: 'D1' },
            { id: 'b', type: 'Facility', customName: 'D1' },
          ],
        },
      ],
    });
    expect(
      resolveTaskFacilities(body([{ id: 'r', mapCode: 'D1' }]), dup).unresolved,
    ).toHaveLength(1);
  });
});
