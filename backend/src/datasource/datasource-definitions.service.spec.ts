import { DataSourceType, type DataSource_ } from '../database/entities/data-source.entity';
import { DatasourceDefinitionsService } from './datasource-definitions.service';

describe('DatasourceDefinitionsService', () => {
  it('保存穩定 sourceKey，且公開結果不帶 token 等未允許欄位', async () => {
    const rows: DataSource_[] = [];
    const repository = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(async ({ where: { sourceKey } }) => rows.find((row) => row.sourceKey === sourceKey) ?? null),
      create: jest.fn((value) => value as DataSource_),
      save: jest.fn(async (row: DataSource_) => {
        const at = rows.findIndex((item) => item.sourceKey === row.sourceKey);
        const saved = { id: row.id ?? 'uuid', ...row } as DataSource_;
        if (at < 0) rows.push(saved); else rows[at] = saved;
        return saved;
      }),
    };
    const service = new DatasourceDefinitionsService(repository as never);

    const saved = await service.save('shared-source', {
      name: '共用來源',
      type: DataSourceType.MQTT,
      backendUrl: 'https://example.test',
      mqttTopic: 'fleet/+/state',
      description: '公開說明',
      ...({ token: 'never-store-this' } as object),
    });

    expect(saved.id).toBe('shared-source');
    expect(saved).not.toHaveProperty('token');
    expect(rows[0].config).toEqual({ backendUrl: 'https://example.test', mqttTopic: 'fleet/+/state' });
  });
});
