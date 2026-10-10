import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { DashboardPlane } from '../database/entities/dashboard-plane.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { VehicleDefinition } from '../database/entities/vehicle-definition.entity';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

/** 地圖上的車輛外觀設定：引用哪個模型、畫多大、行為圖示怎麼放 */
export type MapVehicleSetting = {
  definitionKey: string;
  /** 選定當時的模型版本（稽核用；即時畫面一律用模型最新版） */
  definitionVersion: number | null;
  /** 顯示尺寸上限框（px，橫向＝沿軌道）。車身照自己的比例等比塞進去 */
  displayWidthPx: number;
  displayHeightPx: number;
  actionIconRules?: unknown[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
  updatedAt: number;
  updatedBy: string | null;
  /** 從哪裡搬來的（遷移時記錄來源儀表板元件） */
  migratedFrom?: { planeId: string; elementId: string; childId: string | null } | null;
};

export type MapVehicleResolution = {
  mapId: string;
  /** map：地圖自己的設定；default：系統預設模型；none：都沒有 */
  source: 'map' | 'default' | 'none';
  setting: MapVehicleSetting | null;
  definition: VehicleDefinition | null;
  /** 設定引用的模型已不存在 */
  missingDefinitionKey: string | null;
};

export type VehicleModelReference =
  | { kind: 'default' }
  | { kind: 'map'; mapId: string }
  | {
      kind: 'dashboard';
      planeId: string;
      planeName: string;
      elementId: string;
      childId: string | null;
      label: string | null;
    };

const DEFAULT_KEY = 'vehicle_model.default';
const MAP_PREFIX = 'vehicle_model.map.';
const MIGRATION_PREFIX = 'vehicle_model.migration.';
export const VEHICLE_MODEL_TAG = 'domain:vehicle_models';

const MIN_DISPLAY_PX = 8;
const MAX_DISPLAY_PX = 600;

type PlaneElement = {
  id?: string;
  type?: string;
  canvasKind?: string;
  mapId?: string;
  vehicleDefinitionId?: string;
  vehicleDefinitionName?: string;
  vehicleDisplayWidthPx?: number;
  vehicleDisplayHeightPx?: number;
  children?: PlaneChild[];
};
type PlaneChild = {
  id?: string;
  type?: string;
  label?: string;
  width?: number;
  height?: number;
  vehicleDefinitionId?: string;
  actionIconRules?: unknown[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
};

export type MigrationReport = {
  migrationId: string | null;
  dryRun: boolean;
  at: number;
  created: Array<{ mapId: string; setting: MapVehicleSetting; note: string | null }>;
  skipped: Array<{ mapId: string; reason: string }>;
  conflicts: Array<{ mapId: string; reason: string; candidates: unknown[] }>;
  defaultSet: string | null;
  previousDefault: MapVehicleSetting | null;
};

/**
 * 地圖的車輛模型設定與解析（圖資管理 → 車輛模型）。
 *
 * 模型本身仍是 vehicle_definitions 的共用資產；這裡只存「哪張地圖用哪個模型、畫多大」，
 * 放在 system_settings（一張地圖一筆、預設模型一筆），不另建模型表。
 *
 * 解析順序只看明確引用：地圖自己的設定 → 系統預設模型 → 沒有。不再依模型名稱
 * 「VTMS 巴士 · PMS01」或清單第一筆決定正式使用的模型。
 */
@Injectable()
export class MapVehicleSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
    @InjectRepository(VehicleDefinition)
    private readonly definitions: Repository<VehicleDefinition>,
    @InjectRepository(DashboardPlane)
    private readonly planes: Repository<DashboardPlane>,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async list(): Promise<{
    defaultDefinitionKey: string | null;
    defaultSetting: MapVehicleSetting | null;
    maps: Record<string, MapVehicleSetting>;
  }> {
    const rows = await this.settings.find({
      where: { settingKey: Like(`${MAP_PREFIX}%`) },
    });
    const maps: Record<string, MapVehicleSetting> = {};
    for (const row of rows) {
      const value = row.settingValue as MapVehicleSetting | null;
      if (value?.definitionKey)
        maps[row.settingKey.slice(MAP_PREFIX.length)] = value;
    }
    const defaultSetting = await this.getDefault();
    return {
      defaultDefinitionKey: defaultSetting?.definitionKey ?? null,
      defaultSetting,
      maps,
    };
  }

  /** 系統預設：地圖沒有自己的設定時用的模型與顯示尺寸（跟地圖設定同格式） */
  async getDefault(): Promise<MapVehicleSetting | null> {
    const row = await this.settings.findOne({ where: { settingKey: DEFAULT_KEY } });
    const value = row?.settingValue as MapVehicleSetting | null;
    return typeof value?.definitionKey === 'string' &&
      Number.isFinite(value.displayWidthPx) &&
      Number.isFinite(value.displayHeightPx)
      ? value
      : null;
  }

  async getDefaultKey(): Promise<string | null> {
    return (await this.getDefault())?.definitionKey ?? null;
  }

  async setDefault(input: Partial<MapVehicleSetting> | null, by?: string) {
    const setting = input?.definitionKey ? await this.buildSetting(input, by) : null;
    await this.writeSetting(
      DEFAULT_KEY,
      setting,
      '系統預設車輛模型與顯示尺寸（地圖沒有自己的設定時使用）',
      by,
    );
    this.emit('default_changed');
    return { defaultSetting: setting };
  }

  async getSetting(mapId: string): Promise<MapVehicleSetting | null> {
    const row = await this.settings.findOne({
      where: { settingKey: MAP_PREFIX + this.mapKey(mapId) },
    });
    const value = row?.settingValue as MapVehicleSetting | null;
    return value?.definitionKey ? value : null;
  }

  async putSetting(
    mapId: string,
    input: Partial<MapVehicleSetting>,
    by?: string,
  ): Promise<MapVehicleSetting> {
    const key = this.mapKey(mapId);
    const setting = await this.buildSetting(input, by);
    await this.writeSetting(
      MAP_PREFIX + key,
      setting,
      `地圖 ${key} 的車輛模型與顯示尺寸`,
      by,
    );
    this.emit('map_setting_changed');
    return setting;
  }

  private async buildSetting(
    input: Partial<MapVehicleSetting>,
    by?: string,
  ): Promise<MapVehicleSetting> {
    const definitionKey = String(input.definitionKey ?? '').trim();
    if (!definitionKey) throw new BadRequestException('請選擇車輛模型');
    const definition = await this.requireDefinition(definitionKey);
    const setting: MapVehicleSetting = {
      definitionKey,
      definitionVersion: definition.version ?? null,
      displayWidthPx: this.size(input.displayWidthPx, 'displayWidthPx'),
      displayHeightPx: this.size(input.displayHeightPx, 'displayHeightPx'),
      ...(Array.isArray(input.actionIconRules)
        ? { actionIconRules: input.actionIconRules }
        : {}),
      ...(this.finite(input.behaviorOffsetX) !== null
        ? { behaviorOffsetX: this.finite(input.behaviorOffsetX)! }
        : {}),
      ...(this.finite(input.behaviorOffsetY) !== null
        ? { behaviorOffsetY: this.finite(input.behaviorOffsetY)! }
        : {}),
      ...(this.finite(input.behaviorIconSize) !== null
        ? {
            behaviorIconSize: Math.min(
              64,
              Math.max(8, this.finite(input.behaviorIconSize)!),
            ),
          }
        : {}),
      updatedAt: Date.now(),
      updatedBy: by ?? null,
      migratedFrom: input.migratedFrom ?? null,
    };
    return setting;
  }

  async deleteSetting(mapId: string) {
    const key = this.mapKey(mapId);
    await this.settings.delete({ settingKey: MAP_PREFIX + key });
    this.emit('map_setting_changed');
    return { deleted: true, mapId: key };
  }

  /** 這張地圖要畫哪個模型、多大（即時監控、降級、圖資預覽、回放保存共用） */
  async resolve(mapId: string): Promise<MapVehicleResolution> {
    const key = this.mapKey(mapId);
    const setting = await this.getSetting(key);
    if (setting) {
      const definition = await this.definitions.findOne({
        where: { definitionKey: setting.definitionKey },
      });
      return {
        mapId: key,
        source: 'map',
        setting,
        definition,
        missingDefinitionKey: definition ? null : setting.definitionKey,
      };
    }
    const fallback = await this.getDefault();
    if (fallback) {
      const definition = await this.definitions.findOne({
        where: { definitionKey: fallback.definitionKey },
      });
      return {
        mapId: key,
        source: 'default',
        setting: fallback,
        definition,
        missingDefinitionKey: definition ? null : fallback.definitionKey,
      };
    }
    return {
      mapId: key,
      source: 'none',
      setting: null,
      definition: null,
      missingDefinitionKey: null,
    };
  }

  /** 哪些地方正在引用這個模型（刪除保護、清單上的「使用中」） */
  async references(definitionKey: string): Promise<VehicleModelReference[]> {
    const out: VehicleModelReference[] = [];
    if ((await this.getDefaultKey()) === definitionKey) out.push({ kind: 'default' });
    const { maps } = await this.list();
    for (const [mapId, setting] of Object.entries(maps)) {
      if (setting.definitionKey === definitionKey) out.push({ kind: 'map', mapId });
    }
    for (const plane of await this.planes.find()) {
      for (const element of (plane.elements ?? []) as PlaneElement[]) {
        if (element.vehicleDefinitionId === definitionKey) {
          out.push({
            kind: 'dashboard',
            planeId: plane.planeId,
            planeName: plane.name,
            elementId: String(element.id ?? ''),
            childId: null,
            label: null,
          });
        }
        for (const child of element.children ?? []) {
          if (child.type === 'vehicle-container' && child.vehicleDefinitionId === definitionKey) {
            out.push({
              kind: 'dashboard',
              planeId: plane.planeId,
              planeName: plane.name,
              elementId: String(element.id ?? ''),
              childId: String(child.id ?? ''),
              label: child.label ?? null,
            });
          }
        }
      }
    }
    return out;
  }

  /**
   * 把儀表板圖台上「載具容器」的模型與尺寸搬成地圖設定。
   *
   * - 只新增地圖設定，不改 dashboard_planes（布局、欄寬、其他配置原封不動）。
   * - 可重複執行：地圖已經有設定就跳過，不覆蓋。
   * - 同一張地圖在不同儀表板設得不一樣：列為衝突，不替使用者挑。
   * - 引用的模型不在後端（只在某台瀏覽器）：列出來，不假裝搬好了。
   * - 正式執行會留一筆遷移紀錄（含當時的預設模型），可以 rollback。
   */
  async migrateFromDashboards(dryRun: boolean, by?: string): Promise<MigrationReport> {
    const at = Date.now();
    const report: MigrationReport = {
      migrationId: null,
      dryRun,
      at,
      created: [],
      skipped: [],
      conflicts: [],
      defaultSet: null,
      previousDefault: await this.getDefault(),
    };
    const definitions = await this.definitions.find();
    const byKey = new Map(definitions.map((row) => [row.definitionKey, row]));
    const candidates = new Map<
      string,
      Array<{ setting: Partial<MapVehicleSetting>; note: string | null }>
    >();
    for (const plane of await this.planes.find()) {
      for (const element of (plane.elements ?? []) as PlaneElement[]) {
        if (element.canvasKind !== 'map-platform' || !element.mapId) continue;
        const child =
          (element.children ?? []).find((item) => item.type === 'vehicle-container') ?? null;
        let definitionKey = child?.vehicleDefinitionId ?? element.vehicleDefinitionId ?? null;
        let note: string | null = null;
        if (!definitionKey && element.vehicleDefinitionName) {
          // 舊資料只存了名稱：只有剛好一個同名模型時才對應，並在報告註明
          const named = definitions.filter((row) => row.name === element.vehicleDefinitionName);
          if (named.length === 1) {
            definitionKey = named[0].definitionKey;
            note = `依名稱「${element.vehicleDefinitionName}」對應到唯一模型`;
          } else {
            report.conflicts.push({
              mapId: element.mapId,
              reason: `只有模型名稱「${element.vehicleDefinitionName}」，找到 ${named.length} 個同名模型，無法確定`,
              candidates: named.map((row) => row.definitionKey),
            });
            continue;
          }
        }
        if (!definitionKey) continue;
        const list = candidates.get(element.mapId) ?? [];
        list.push({
          note,
          setting: {
            definitionKey,
            displayWidthPx: child?.width ?? element.vehicleDisplayWidthPx,
            displayHeightPx: child?.height ?? element.vehicleDisplayHeightPx,
            actionIconRules: child?.actionIconRules,
            behaviorOffsetX: child?.behaviorOffsetX,
            behaviorOffsetY: child?.behaviorOffsetY,
            behaviorIconSize: child?.behaviorIconSize,
            migratedFrom: {
              planeId: plane.planeId,
              elementId: String(element.id ?? ''),
              childId: child?.id ? String(child.id) : null,
            },
          },
        });
        candidates.set(element.mapId, list);
      }
    }

    const usedKeys = new Set<string>();
    const usedSettings: Partial<MapVehicleSetting>[] = [];
    for (const [mapId, list] of candidates) {
      if (await this.getSetting(mapId)) {
        report.skipped.push({ mapId, reason: '地圖已有車輛模型設定，不覆蓋' });
        continue;
      }
      const distinct = new Map(
        list.map((item) => [JSON.stringify({ ...item.setting, migratedFrom: undefined }), item]),
      );
      if (distinct.size > 1) {
        report.conflicts.push({
          mapId,
          reason: '多個儀表板對這張地圖設定了不同的模型或尺寸，請在圖資管理手動選擇',
          candidates: [...distinct.values()].map((item) => item.setting),
        });
        continue;
      }
      const chosen = list[0];
      const key = chosen.setting.definitionKey!;
      if (!byKey.has(key)) {
        report.skipped.push({
          mapId,
          reason: `引用的模型 ${key} 不在後端（可能只存在某台瀏覽器），請先用「匯入此瀏覽器的舊模型」上傳`,
        });
        continue;
      }
      if (
        !Number.isFinite(Number(chosen.setting.displayWidthPx)) ||
        !Number.isFinite(Number(chosen.setting.displayHeightPx))
      ) {
        report.skipped.push({
          mapId,
          reason: '儀表板上沒有顯示尺寸，請在圖資管理手動設定',
        });
        continue;
      }
      usedKeys.add(key);
      usedSettings.push(chosen.setting);
      if (dryRun) {
        report.created.push({
          mapId,
          setting: {
            ...(chosen.setting as MapVehicleSetting),
            definitionVersion: byKey.get(key)!.version ?? null,
            displayWidthPx: this.size(chosen.setting.displayWidthPx, 'displayWidthPx'),
            displayHeightPx: this.size(chosen.setting.displayHeightPx, 'displayHeightPx'),
            updatedAt: at,
            updatedBy: by ?? null,
          },
          note: chosen.note,
        });
      } else {
        const saved = await this.putSetting(mapId, chosen.setting, by ?? 'migration');
        report.created.push({ mapId, setting: saved, note: chosen.note });
      }
    }
    // 預設模型：沒設過、而且搬過來的地圖都用同一個模型時才設，否則留給使用者決定
    if (!report.previousDefault && usedKeys.size === 1) {
      report.defaultSet = [...usedKeys][0];
      if (!dryRun) await this.setDefault(usedSettings[0], by ?? 'migration');
    }
    if (!dryRun && (report.created.length > 0 || report.defaultSet)) {
      report.migrationId = String(at);
      await this.writeSetting(
        MIGRATION_PREFIX + report.migrationId,
        report,
        '車輛模型設定遷移紀錄（可回復）',
        by,
      );
    }
    return report;
  }

  async listMigrations() {
    const rows = await this.settings.find({
      where: { settingKey: Like(`${MIGRATION_PREFIX}%`) },
      order: { settingKey: 'DESC' },
    });
    return rows.map((row) => row.settingValue as MigrationReport & { rolledBackAt?: number });
  }

  /**
   * 回復一次遷移：只刪除「遷移建立、之後沒有人改過」的地圖設定；被改過的保留並列出。
   * 預設模型同理：還是遷移設的那一個才還原成遷移前的值。
   */
  async rollbackMigration(migrationId: string, by?: string) {
    const row = await this.settings.findOne({
      where: { settingKey: MIGRATION_PREFIX + migrationId },
    });
    const report = row?.settingValue as (MigrationReport & { rolledBackAt?: number }) | null;
    if (!row || !report) throw new NotFoundException(`找不到遷移紀錄 ${migrationId}`);
    if (report.rolledBackAt) return { alreadyRolledBack: true, rolledBackAt: report.rolledBackAt };
    const removed: string[] = [];
    const kept: Array<{ mapId: string; reason: string }> = [];
    for (const item of report.created) {
      const current = await this.getSetting(item.mapId);
      if (!current) continue;
      if (current.updatedAt !== item.setting.updatedAt) {
        kept.push({ mapId: item.mapId, reason: '遷移之後有人改過，保留' });
        continue;
      }
      await this.settings.delete({ settingKey: MAP_PREFIX + item.mapId });
      removed.push(item.mapId);
    }
    let defaultRestored = false;
    if (report.defaultSet && (await this.getDefaultKey()) === report.defaultSet) {
      await this.setDefault(report.previousDefault, by);
      defaultRestored = true;
    }
    row.settingValue = { ...report, rolledBackAt: Date.now() };
    await this.settings.save(row);
    this.emit('migration_rolled_back');
    return { removed, kept, defaultRestored };
  }

  private async requireDefinition(definitionKey: string) {
    const definition = await this.definitions.findOne({ where: { definitionKey } });
    if (!definition) throw new BadRequestException(`車輛模型 ${definitionKey} 不存在`);
    return definition;
  }

  private mapKey(mapId: string) {
    const key = String(mapId ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(key)) throw new BadRequestException('地圖 ID 格式不正確');
    return key;
  }

  private size(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestException(`${name} 必須是數字`);
    return Math.min(MAX_DISPLAY_PX, Math.max(MIN_DISPLAY_PX, Math.round(number)));
  }

  private finite(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private async writeSetting(
    settingKey: string,
    value: unknown,
    description: string,
    by?: string,
  ) {
    const existing = await this.settings.findOne({ where: { settingKey } });
    if (value === null) {
      if (existing) await this.settings.delete({ settingKey });
      return;
    }
    if (existing) {
      existing.settingValue = value as never;
      existing.updatedAt = Date.now();
      existing.updatedBy = by ?? existing.updatedBy;
      await this.settings.save(existing);
      return;
    }
    await this.settings.save(
      this.settings.create({
        settingKey,
        settingValue: value as never,
        valueType: 'json',
        description,
        updatedBy: by ?? undefined,
      }),
    );
  }

  private emit(reason: string) {
    this.invalidation.emit([VEHICLE_MODEL_TAG], reason);
  }
}
