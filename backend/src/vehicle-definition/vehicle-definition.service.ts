import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleDefinition } from '../database/entities/vehicle-definition.entity';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import {
  MapVehicleSettingsService,
  VEHICLE_MODEL_TAG,
} from './map-vehicle-settings.service';

/**
 * 車輛外觀模型（TP13C §1.4 主檔 · vehicle_definitions），圖資管理 → 車輛模型。
 *
 * <h3>逐筆存取，不再整批取代</h3>
 * 原本是 PUT 整份清單、沒出現的就刪掉，而編輯器一開就把瀏覽器快取整批推上來——
 * 一台快取過期的瀏覽器就能蓋掉、甚至刪掉別人剛存的模型。現在：
 * - 新增／修改逐筆，修改要帶 baseVersion，跟伺服器目前版本不同就 409，不覆蓋別人的新版本。
 * - 內容沒變不遞增版本。
 * - 刪除前檢查引用（地圖設定、預設模型、儀表板元件），有引用就拒絕，不留下失效引用。
 *
 * 模型的對外身分是 definitionKey（前端的 id）：圖台元件、地圖設定綁的都是它。
 */
export type VehicleDefinitionPayload = {
  definitionKey: string;
  name: string;
  vehicleModel?: string | null;
  width?: number | null;
  height?: number | null;
  backgroundColor?: string | null;
  elements: unknown;
  previewData?: unknown;
  rearAxleFromTailRatio?: number | null;
  version?: number | null;
  createdBy?: string | null;
};

const KEY_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

@Injectable()
export class VehicleDefinitionService {
  constructor(
    @InjectRepository(VehicleDefinition)
    private readonly repository: Repository<VehicleDefinition>,
    private readonly mapSettings: MapVehicleSettingsService,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async list(): Promise<VehicleDefinition[]> {
    return this.repository.find({ order: { createdAt: 'ASC' } });
  }

  async findOne(definitionKey: string): Promise<VehicleDefinition> {
    const found = await this.repository.findOne({ where: { definitionKey } });
    if (!found) {
      throw new NotFoundException(`找不到載具定義：${definitionKey}`);
    }
    return found;
  }

  /**
   * 新增或修改一個模型。
   *
   * baseVersion：前端拿到的那一版。已存在的模型一定要帶，且必須等於伺服器目前版本；
   * 不存在的模型不帶（或 0）。同 ID 不同內容時由前端先比對、讓使用者決定，這裡不替人蓋。
   */
  async upsert(
    definitionKey: string,
    payload: VehicleDefinitionPayload,
    baseVersion: number | null,
    updatedBy?: string,
  ): Promise<VehicleDefinition> {
    const key = String(definitionKey ?? '').trim();
    if (!KEY_PATTERN.test(key)) throw new BadRequestException('模型 ID 格式不正確');
    if (!Array.isArray(payload?.elements))
      throw new BadRequestException('模型內容缺少元件清單');
    const prior = await this.repository.findOne({ where: { definitionKey: key } });
    if (prior) {
      if (baseVersion === null || baseVersion === undefined) {
        throw new ConflictException({
          message: `已有同 ID 的模型「${prior.name}」，請先比對內容再決定`,
          current: prior,
        });
      }
      if (Number(baseVersion) !== Number(prior.version)) {
        throw new ConflictException({
          message: `模型「${prior.name}」已被更新為第 ${prior.version} 版，請重新載入再修改`,
          current: prior,
        });
      }
      if (sameContent(prior, payload)) return prior;
    } else if (baseVersion) {
      throw new ConflictException({ message: `模型 ${key} 已被刪除`, current: null });
    }
    const now = Date.now();
    const row =
      prior ?? this.repository.create({ definitionKey: key, createdAt: now });
    row.name = String(payload.name ?? '').trim() || key;
    row.vehicleModel = payload.vehicleModel ?? undefined!;
    row.width = payload.width ?? undefined!;
    row.height = payload.height ?? undefined!;
    row.backgroundColor = payload.backgroundColor ?? undefined!;
    row.elements = payload.elements;
    row.previewData = payload.previewData ?? undefined!;
    row.rearAxleFromTailRatio =
      typeof payload.rearAxleFromTailRatio === 'number' &&
      Number.isFinite(payload.rearAxleFromTailRatio)
        ? payload.rearAxleFromTailRatio
        : null;
    row.version = prior ? (prior.version ?? 0) + 1 : 1;
    row.createdBy = prior?.createdBy ?? payload.createdBy ?? updatedBy ?? undefined!;
    row.updatedAt = now;
    const saved = await this.repository.save(row);
    this.invalidation.emit([VEHICLE_MODEL_TAG], 'vehicle_model_saved');
    return saved;
  }

  /** 刪除：有任何引用就拒絕，回傳引用清單讓使用者先改掉 */
  async remove(definitionKey: string) {
    const row = await this.findOne(definitionKey);
    const references = await this.mapSettings.references(definitionKey);
    if (references.length > 0) {
      throw new ConflictException({
        message: `模型「${row.name}」仍被 ${references.length} 處使用，請先改用其他模型`,
        references,
      });
    }
    await this.repository.remove(row);
    this.invalidation.emit([VEHICLE_MODEL_TAG], 'vehicle_model_deleted');
    return { deleted: true, definitionKey };
  }

  references(definitionKey: string) {
    return this.mapSettings.references(definitionKey);
  }
}

/** 內容比對：只看外觀資料，不看版本與時間 */
function sameContent(row: VehicleDefinition, payload: VehicleDefinitionPayload) {
  const pick = (value: {
    name?: unknown;
    vehicleModel?: unknown;
    width?: unknown;
    height?: unknown;
    backgroundColor?: unknown;
    elements?: unknown;
    previewData?: unknown;
    rearAxleFromTailRatio?: unknown;
  }) =>
    stableStringify({
      name: value.name ?? null,
      vehicleModel: value.vehicleModel ?? null,
      width: value.width ?? null,
      height: value.height ?? null,
      backgroundColor: value.backgroundColor ?? null,
      elements: value.elements ?? [],
      previewData: value.previewData ?? null,
      rearAxleFromTailRatio: value.rearAxleFromTailRatio ?? null,
    });
  return pick(row) === pick(payload);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
