import { Injectable, NotFoundException } from '@nestjs/common';
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
  ) {}

  async listPlanes(): Promise<DashboardPlane[]> {
    return this.planes.find({ order: { createdAt: 'ASC' } });
  }

  async findPlane(planeId: string): Promise<DashboardPlane> {
    const found = await this.planes.findOne({ where: { planeId } });
    if (!found) throw new NotFoundException(`找不到圖台版面：${planeId}`);
    return found;
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
    await this.pages.clear();
    let order = 0;
    for (const item of items) {
      if (!item.moduleId?.trim() || !item.planeId?.trim()) continue;
      const row = this.pages.create({
        id: item.id,
        moduleId: item.moduleId.trim(),
        label: item.label ?? '',
        planeId: item.planeId.trim(),
        sortOrder: item.sortOrder ?? order,
        isActive: true,
        createdBy: updatedBy ?? undefined!,
        createdAt: now,
        updatedAt: now,
      });
      order += 1;
      await this.pages.save(row);
    }
    return this.listPages();
  }
}
