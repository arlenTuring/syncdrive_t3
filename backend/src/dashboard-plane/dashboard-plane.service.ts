import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

/** 版面存檔的失效標籤（前端 useDashboardEditor 收到就重新讀取版面） */
export const DASHBOARD_PLANES_TAG = 'table:dashboard_planes';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DashboardPlane,
  DashboardViewportMode,
} from '../database/entities/dashboard-plane.entity';
import { ModuleDashboardPage } from '../database/entities/module-dashboard-page.entity';

/**
 * 營運全景圖台版面與模組頁面對應
 * （TP13C §1.4 介面資源 · dashboard_planes、module_dashboard_pages）。
 *
 * <strong>為什麼要有這一支。</strong>版面原本只存在瀏覽器
 * <code>localStorage['syncdrive_dashboard_planes']</code>：換一台電腦或清一次快取就
 * 沒了，匯入匯出也只是讀寫本機 JSON，沒有任何伺服器端版本紀錄。模組頁面對應更是
 * <strong>系統配置而非個人偏好</strong>——管理者設定好之後，所有操作人員看到的模組
 * 頁面必須一致。
 *
 * <strong>版面以 planeId 為單位整份取放。</strong>元件樹的結構隨元件型別擴充，
 * 對它做關聯查詢只會把 schema 綁死在今天的元件型別上；整包 jsonb 存取則讓元件
 * 怎麼演進都不必動資料庫。
 */
export type DashboardPlanePayload = {
  planeId: string;
  name: string;
  width: number;
  height: number;
  viewportMode?: string | null;
  elements: unknown;
  isTemplate?: boolean | null;
  updatedBy?: string | null;
};

export type ModuleDashboardPagePayload = {
  /** 前端的頁面識別碼；不是 uuid，存進 pageKey 而不是主鍵 */
  id?: string;
  moduleId: string;
  label: string;
  planeId: string;
  sortOrder?: number | null;
};

function toViewportMode(value?: string | null): DashboardViewportMode {
  return value === DashboardViewportMode.FIT_WIDTH
    ? DashboardViewportMode.FIT_WIDTH
    : DashboardViewportMode.FIXED_SCALE;
}

@Injectable()
export class DashboardPlaneService {
  constructor(
    @InjectRepository(DashboardPlane)
    private readonly planes: Repository<DashboardPlane>,
    @InjectRepository(ModuleDashboardPage)
    private readonly pages: Repository<ModuleDashboardPage>,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  /** 版面存檔後通知所有開著的頁面重新讀取（其他帳號、其他瀏覽器才看得到同一份） */
  private notifyPlanesChanged(reason: string): void {
    this.invalidation?.emit([DASHBOARD_PLANES_TAG], reason);
  }

  async listPlanes(): Promise<DashboardPlane[]> {
    return this.planes.find({ order: { createdAt: 'ASC' } });
  }

  async findPlane(planeId: string): Promise<DashboardPlane> {
    const found = await this.planes.findOne({ where: { planeId } });
    if (!found) throw new NotFoundException(`找不到圖台版面：${planeId}`);
    return found;
  }

  /** 單份 upsert；資料升級或樣板匯入不得為了改一份版面刪掉其他版面。 */
  async savePlane(item: DashboardPlanePayload & { expectedVersion?: number | null }): Promise<DashboardPlane> {
    const key = item.planeId?.trim();
    if (!key) throw new NotFoundException('缺少圖台版面 ID');
    const now = Date.now();
    const prior = await this.planes.findOne({ where: { planeId: key } });
    // 樂觀鎖：送出時依據的版本跟資料庫不同，代表讀取之後有人存過，不覆蓋
    if (item.expectedVersion != null && prior && prior.version !== item.expectedVersion) {
      throw new ConflictException(
        `版面 ${key} 已被更新（目前版本 ${prior.version}，送出時依據 ${item.expectedVersion}），請重新讀取後再存`,
      );
    }
    const row = prior ?? this.planes.create({ planeId: key, createdAt: now });
    row.name = item.name ?? key;
    row.width = item.width ?? 1920;
    row.height = item.height ?? 1080;
    row.viewportMode = toViewportMode(item.viewportMode);
    row.elements = item.elements ?? [];
    row.isTemplate = item.isTemplate ?? false;
    row.version = prior ? (prior.version ?? 0) + 1 : 1;
    row.updatedBy = item.updatedBy ?? undefined!;
    row.updatedAt = now;
    const saved = await this.planes.save(row);
    this.notifyPlanesChanged('dashboard_plane_saved');
    return saved;
  }

  /**
   * 整批覆寫版面清單。
   *
   * 圖台編輯器在畫面上操作的是一整份版面清單（新增、刪除、改名、改元件樹都在同一
   * 個 state），逐筆 PATCH 會逼前端自己追蹤哪一份變了，刪除尤其容易漏同步。版面
   * 數量是個位數到數十，整批寫入成本可以忽略。
   */
  async replacePlanes(
    items: DashboardPlanePayload[],
    updatedBy?: string,
  ): Promise<DashboardPlane[]> {
    const now = Date.now();
    const keys = items
      .map((item) => item.planeId?.trim())
      .filter((key): key is string => Boolean(key));
    const existing = keys.length
      ? await this.planes.find({ where: { planeId: In(keys) } })
      : [];
    const byKey = new Map(existing.map((row) => [row.planeId, row]));

    const saved: DashboardPlane[] = [];
    for (const item of items) {
      const key = item.planeId?.trim();
      if (!key) continue;
      const prior = byKey.get(key);
      const row = prior ?? this.planes.create({ planeId: key, createdAt: now });
      row.name = item.name ?? key;
      row.width = item.width ?? 1920;
      row.height = item.height ?? 1080;
      row.viewportMode = toViewportMode(item.viewportMode);
      row.elements = item.elements ?? [];
      row.isTemplate = item.isTemplate ?? false;
      // 版本由伺服器遞增，前端不必自己維護
      row.version = prior ? (prior.version ?? 0) + 1 : 1;
      row.updatedBy = item.updatedBy ?? updatedBy ?? undefined!;
      row.updatedAt = now;
      saved.push(await this.planes.save(row));
    }

    // 這一批沒提到的，代表在編輯器裡被刪掉了
    const keep = saved.map((row) => row.planeId);
    const all = await this.planes.find();
    const removable = all.filter((row) => !keep.includes(row.planeId));
    if (removable.length > 0) await this.planes.remove(removable);

    this.notifyPlanesChanged('dashboard_planes_replaced');
    return this.listPlanes();
  }

  async listPages(moduleId?: string): Promise<ModuleDashboardPage[]> {
    return this.pages.find({
      where: moduleId ? { moduleId, isActive: true } : { isActive: true },
      order: { moduleId: 'ASC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  /** 模組頁面對應同樣整批覆寫——它是一份設定清單，語意與版面一致 */
  async replacePages(
    items: ModuleDashboardPagePayload[],
    updatedBy?: string,
  ): Promise<ModuleDashboardPage[]> {
    const now = Date.now();
    /**
     * <strong>先存後刪，不要先 clear() 再插入。</strong>
     *
     * 先前是 <code>clear()</code>（TRUNCATE）之後重新插入：中途只要有一筆失敗，
     * 整份模組頁面對應就全沒了，而且那是無法從伺服器端復原的——它本來就是這裡的
     * 唯一真相。改成與版面、載具定義同一套順序：先依 pageKey 建立或更新，全部成功
     * 之後才刪掉這一批沒提到的那些。
     */
    const existing = await this.pages.find();
    const byKey = new Map(existing.map((row) => [row.pageKey, row]));

    const saved: ModuleDashboardPage[] = [];
    let order = 0;
    for (const item of items) {
      if (!item.moduleId?.trim() || !item.planeId?.trim()) continue;
      const key = item.id?.trim() || `mdp-${now.toString(36)}-${order}`;
      const prior = byKey.get(key);
      const row =
        prior ??
        this.pages.create({
          pageKey: key,
          createdAt: now,
          createdBy: updatedBy,
        });
      row.moduleId = item.moduleId.trim();
      row.label = item.label ?? '';
      row.planeId = item.planeId.trim();
      row.sortOrder = item.sortOrder ?? order;
      row.isActive = true;
      row.updatedAt = now;
      order += 1;
      saved.push(await this.pages.save(row));
    }

    const keep = saved.map((row) => row.pageKey);
    const removable = existing.filter((row) => !keep.includes(row.pageKey));
    if (removable.length > 0) await this.pages.remove(removable);

    return this.listPages();
  }
}
