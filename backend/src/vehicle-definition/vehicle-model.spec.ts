import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { MapVehicleSettingsService } from './map-vehicle-settings.service';
import { VehicleDefinitionService } from './vehicle-definition.service';

/** 記憶體版的 repository：只實作這兩個服務用到的方法 */
function memoryRepo<T extends Record<string, unknown>>(key: keyof T, rows: T[] = []) {
  const data = new Map<unknown, T>(rows.map((row) => [row[key], row]));
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && '_type' in (v as object)) {
        const like = String((v as { _value: string })._value).replace(/%$/, '');
        return String(row[k]).startsWith(like);
      }
      return row[k] === v;
    });
  return {
    data,
    find: jest.fn(async (opts?: { where?: Record<string, unknown> }) =>
      [...data.values()].filter((row) => !opts?.where || matches(row, opts.where)),
    ),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...data.values()].find((row) => matches(row, where)) ?? null,
    ),
    create: (value: Partial<T>) => ({ ...value }) as T,
    save: jest.fn(async (value: T) => {
      data.set(value[key], value);
      return value;
    }),
    remove: jest.fn(async (value: T) => {
      data.delete(value[key]);
      return value;
    }),
    delete: jest.fn(async (where: Record<string, unknown>) => {
      for (const [id, row] of data) if (matches(row, where)) data.delete(id);
    }),
  };
}

const body = { id: 'body', type: 'body', x: 0, y: 0, width: 260, height: 78 };

function createHarness() {
  const definitions = memoryRepo<Record<string, unknown>>('definitionKey', [
    { definitionKey: 'bus', name: '巴士', version: 2, elements: [body], width: 260, height: 78, createdAt: 1, updatedAt: 1 },
    { definitionKey: 'spare', name: '備用', version: 1, elements: [body], createdAt: 1, updatedAt: 1 },
  ]);
  const settings = memoryRepo<Record<string, unknown>>('settingKey');
  const planes = memoryRepo<Record<string, unknown>>('planeId', [
    {
      planeId: 'plane-1',
      name: '總控大屏',
      elements: [
        {
          id: 'canvas-1',
          canvasKind: 'map-platform',
          mapId: 'map-a',
          children: [
            {
              id: 'container-1',
              type: 'vehicle-container',
              label: 'PMS01',
              width: 88,
              height: 30,
              vehicleDefinitionId: 'bus',
              behaviorOffsetY: -41,
              actionIconRules: [{ id: 'r1' }],
            },
          ],
        },
      ],
    },
  ]);
  const invalidation = { emit: jest.fn() };
  const mapSettings = new MapVehicleSettingsService(
    settings as never,
    definitions as never,
    planes as never,
    invalidation as never,
  );
  const models = new VehicleDefinitionService(
    definitions as never,
    mapSettings,
    invalidation as never,
  );
  return { definitions, settings, planes, mapSettings, models, invalidation };
}

describe('vehicle models (per-item, versioned)', () => {
  it('rejects a stale or missing baseVersion instead of overwriting', async () => {
    const h = createHarness();
    const item = { definitionKey: 'bus', name: '改名', elements: [body] };
    await expect(h.models.upsert('bus', item, 1)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.models.upsert('bus', item, null)).rejects.toBeInstanceOf(ConflictException);
    expect(h.definitions.data.get('bus')).toMatchObject({ name: '巴士', version: 2 });
    const saved = await h.models.upsert('bus', item, 2);
    expect(saved).toMatchObject({ name: '改名', version: 3 });
    expect(h.invalidation.emit).toHaveBeenCalledWith(['domain:vehicle_models'], 'vehicle_model_saved');
  });

  it('does not bump the version when content is unchanged', async () => {
    const h = createHarness();
    const saved = await h.models.upsert(
      'bus',
      { definitionKey: 'bus', name: '巴士', elements: [body], width: 260, height: 78 },
      2,
    );
    expect(saved.version).toBe(2);
  });

  it('refuses to delete a model that is still referenced, and lists where', async () => {
    const h = createHarness();
    await expect(h.models.remove('bus')).rejects.toMatchObject({
      response: { references: [expect.objectContaining({ kind: 'dashboard', childId: 'container-1' })] },
    });
    expect(h.definitions.data.has('bus')).toBe(true);
    await h.models.remove('spare');
    expect(h.definitions.data.has('spare')).toBe(false);
  });
});

describe('map vehicle settings', () => {
  it('resolves map setting first, then the system default, never by name or list order', async () => {
    const h = createHarness();
    expect((await h.mapSettings.resolve('map-a')).source).toBe('none');
    await h.mapSettings.setDefault({ definitionKey: 'spare', displayWidthPx: 80, displayHeightPx: 24 });
    expect(await h.mapSettings.resolve('map-a')).toMatchObject({ source: 'default', setting: { definitionKey: 'spare' } });
    await h.mapSettings.putSetting('map-a', { definitionKey: 'bus', displayWidthPx: 88, displayHeightPx: 30 });
    expect(await h.mapSettings.resolve('map-a')).toMatchObject({
      source: 'map',
      setting: { definitionKey: 'bus', definitionVersion: 2 },
      definition: { definitionKey: 'bus' },
    });
  });

  it('migrates dashboard containers into map settings without touching planes, idempotently', async () => {
    const h = createHarness();
    const planesBefore = JSON.stringify([...h.planes.data.values()]);
    const dry = await h.mapSettings.migrateFromDashboards(true);
    expect(dry.created).toHaveLength(1);
    expect(await h.mapSettings.getSetting('map-a')).toBeNull();

    const run = await h.mapSettings.migrateFromDashboards(false, 'tester');
    expect(run.migrationId).not.toBeNull();
    expect(await h.mapSettings.getSetting('map-a')).toMatchObject({
      definitionKey: 'bus',
      displayWidthPx: 88,
      displayHeightPx: 30,
      behaviorOffsetY: -41,
      actionIconRules: [{ id: 'r1' }],
      migratedFrom: { planeId: 'plane-1', elementId: 'canvas-1', childId: 'container-1' },
    });
    expect(run.defaultSet).toBe('bus');

    const again = await h.mapSettings.migrateFromDashboards(false);
    expect(again.created).toHaveLength(0);
    expect(again.skipped[0].reason).toContain('不覆蓋');
    expect(JSON.stringify([...h.planes.data.values()])).toBe(planesBefore);
  });

  it('reports conflicting dashboards instead of picking one', async () => {
    const h = createHarness();
    h.planes.data.set('plane-2', {
      planeId: 'plane-2',
      name: '另一張',
      elements: [
        {
          id: 'canvas-2',
          canvasKind: 'map-platform',
          mapId: 'map-a',
          children: [{ id: 'c2', type: 'vehicle-container', width: 120, height: 40, vehicleDefinitionId: 'spare' }],
        },
      ],
    });
    const report = await h.mapSettings.migrateFromDashboards(false);
    expect(report.created).toHaveLength(0);
    expect(report.conflicts[0].mapId).toBe('map-a');
    expect(await h.mapSettings.getSetting('map-a')).toBeNull();
  });

  it('rollback removes only settings nobody changed after the migration', async () => {
    const h = createHarness();
    const run = await h.mapSettings.migrateFromDashboards(false);
    const result = await h.mapSettings.rollbackMigration(run.migrationId!);
    expect(result.removed).toEqual(['map-a']);
    expect(result.defaultRestored).toBe(true);
    expect(await h.mapSettings.getSetting('map-a')).toBeNull();
    expect(await h.mapSettings.getDefault()).toBeNull();

    const second = await h.mapSettings.migrateFromDashboards(false);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await h.mapSettings.putSetting('map-a', { definitionKey: 'bus', displayWidthPx: 100, displayHeightPx: 30 });
    const kept = await h.mapSettings.rollbackMigration(second.migrationId!);
    expect(kept.removed).toEqual([]);
    expect(kept.kept?.[0]?.mapId).toBe('map-a');
    expect(await h.mapSettings.getSetting('map-a')).toMatchObject({ displayWidthPx: 100 });
  });
});
