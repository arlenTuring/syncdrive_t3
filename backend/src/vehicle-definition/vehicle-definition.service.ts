import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VehicleDefinition } from '../database/entities/vehicle-definition.entity';

/**
 * 載具外觀定義（TP13C §1.4 主檔 · vehicle_definitions）。
 *
 * <strong>為什麼要有這一支。</strong>載具定義原本只存在瀏覽器
 * <code>localStorage['syncdrive_vehicle_definitions']</code>：一個人畫好的車輛外觀
 * 別人看不到，換一台電腦、清一次快取就沒了。而它是圖台與車輛監控畫面共用的呈現
 * 資產，文件明訂「任一帳號所見內容一致」。
 *
 * <strong>覆寫語意採整批取代（replaceAll）。</strong>載具編輯器在畫布上是一次操作
 * 一整份清單（新增、刪除、改名、改元件樹都在同一個 state），逐筆 PATCH 會讓前端
 * 得自己追蹤哪一筆變了；整批送出則與編輯器的心智模型一致，也不會出現「刪除沒同步」
 * 這種殘留。清單本身很小（個位數載具），整批寫入的成本可以忽略。
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
  version?: number | null;
  createdBy?: string | null;
};

@Injectable()
export class VehicleDefinitionService {
  constructor(
    @InjectRepository(VehicleDefinition)
    private readonly repository: Repository<VehicleDefinition>,
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
   * 整批取代：送進來的清單就是完整結果，沒出現在清單裡的舊資料一併刪除。
   *
   * 用 definitionKey 對位而不是 id——前端在 localStorage 時代就是用自己的
   * key 在引用載具（圖台元件綁的是那個 key），換成資料庫之後那些引用必須繼續有效，
   * 所以 key 是對外的身分，資料庫的 uuid 只是內部主鍵。
   */
  async replaceAll(
    items: VehicleDefinitionPayload[],
    updatedBy?: string,
  ): Promise<VehicleDefinition[]> {
    const now = Date.now();
    const incomingKeys = items
      .map((item) => item.definitionKey?.trim())
      .filter((key): key is string => Boolean(key));

    const existing = incomingKeys.length
      ? await this.repository.find({
          where: { definitionKey: In(incomingKeys) },
        })
      : [];
    const existingByKey = new Map(
      existing.map((row) => [row.definitionKey, row]),
    );

    const saved: VehicleDefinition[] = [];
    for (const item of items) {
      const key = item.definitionKey?.trim();
      if (!key) continue;
      const prior = existingByKey.get(key);
      const row =
        prior ?? this.repository.create({ definitionKey: key, createdAt: now });
      row.name = item.name ?? key;
      row.vehicleModel = item.vehicleModel ?? undefined!;
      row.width = item.width ?? undefined!;
      row.height = item.height ?? undefined!;
      row.backgroundColor = item.backgroundColor ?? undefined!;
      row.elements = item.elements ?? [];
      row.previewData = item.previewData ?? undefined!;
      // 版本號由伺服器遞增，前端不必自己維護；沒有舊資料就從 1 起算
      row.version = prior ? (prior.version ?? 0) + 1 : (item.version ?? 1);
      row.createdBy =
        prior?.createdBy ?? item.createdBy ?? updatedBy ?? undefined!;
      row.updatedAt = now;
      saved.push(await this.repository.save(row));
    }

    // 這一批沒提到的，代表在編輯器裡被刪掉了
    const keepKeys = saved.map((row) => row.definitionKey);
    const stale = await this.repository.find();
    const removable = stale.filter(
      (row) => !keepKeys.includes(row.definitionKey),
    );
    if (removable.length > 0) {
      await this.repository.remove(removable);
    }

    return this.list();
  }
}
