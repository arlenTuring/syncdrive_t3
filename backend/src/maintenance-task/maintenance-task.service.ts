import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  MaintenanceTask,
  MaintenanceTaskPublishStatus,
  MaintenanceTaskUsageStatus,
} from '../database/entities/maintenance-task.entity';
import {
  toMaintenanceTaskListItem,
  UNTITLED_MAINTENANCE_TASK_NAME,
  type MaintenanceTaskListItem,
} from './maintenance-task-list.util';
import { MapService } from '../map/map.service';
import {
  buildFacilityIndex,
  resolveTaskFacilities,
  type FacilityIndex,
} from './maintenance-task-facilities';

export type ListMaintenanceTasksQuery = {
  keyword?: string;
  usage_status?: 'all' | MaintenanceTaskUsageStatus;
  publish_status?: 'all' | MaintenanceTaskPublishStatus;
  page?: number;
  page_size?: number;
};

export type SaveMaintenanceTaskDraftInput = {
  name: string;
  body?: Record<string, unknown>;
};

@Injectable()
export class MaintenanceTaskService {
  constructor(
    @InjectRepository(MaintenanceTask)
    private readonly repo: Repository<MaintenanceTask>,
    private readonly mapService: MapService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 整備任務設施列所屬的地圖：任務記的 mapId（還在的話），否則目前啟用的地圖。
   * 設施列一律以這張圖的設施 ID 對應，名稱讀取時才從圖上帶出（規則見 maintenance-task-facilities.ts）。
   */
  private async facilityIndexFor(
    body: Record<string, unknown>,
  ): Promise<FacilityIndex | null> {
    const candidates = [
      typeof body.mapId === 'string' ? body.mapId.trim() : '',
      this.mapService.getActiveMapLibraryStatus().activeMapId,
    ].filter((id, i, all) => id && all.indexOf(id) === i);
    for (const mapId of candidates) {
      let mapDocument: Record<string, unknown> | null = null;
      try {
        mapDocument =
          (
            this.mapService.getPublishedMapLibrary(mapId) as {
              mapDocument?: Record<string, unknown>;
            }
          ).mapDocument ?? null;
      } catch {
        continue;
      }
      // 舊資料只存名稱：班表當時記下的站點 ID＋站名，是改名前的名稱對回站點的明確紀錄
      const legacy = await this.dataSource
        .query<Array<{ name: string; station_id: string }>>(
          `SELECT DISTINCT d->>'stationName' AS name, d->>'stationId' AS station_id
         FROM operation_shifts s
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.body->'selectedRoutes') = 'array' THEN s.body->'selectedRoutes' ELSE '[]'::jsonb END) r
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r->'stationDwells') = 'array' THEN r->'stationDwells' ELSE '[]'::jsonb END) d
         WHERE NULLIF(d->>'stationName', '') IS NOT NULL AND NULLIF(d->>'stationId', '') IS NOT NULL`,
        )
        .catch((): Array<{ name: string; station_id: string }> => []);
      return buildFacilityIndex(
        mapId,
        mapDocument,
        legacy.map((row) => ({ name: row.name, stationId: row.station_id })),
      );
    }
    return null;
  }

  /** 設施列依 ID 對好地圖設施（名稱換成目前名稱、舊資料補上 ID）；找不到地圖就原樣 */
  private async withResolvedFacilities(
    body: Record<string, unknown>,
    mode: 'read' | 'write' = 'read',
  ): Promise<Record<string, unknown>> {
    const index = await this.facilityIndexFor(body);
    return index
      ? resolveTaskFacilities(body, index, { annotate: mode === 'read' }).body
      : body;
  }

  async listTasks(query: ListMaintenanceTasksQuery): Promise<{
    items: MaintenanceTaskListItem[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));

    const qb = this.repo.createQueryBuilder('t');

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      qb.andWhere('(t.task_id ILIKE :kw OR t.name ILIKE :kw)', {
        kw: `%${keyword}%`,
      });
    }

    const usageStatus = query.usage_status;
    if (usageStatus && usageStatus !== 'all') {
      qb.andWhere('t.usage_status = :us', { us: usageStatus });
    }

    const publishStatus = query.publish_status;
    if (publishStatus && publishStatus !== 'all') {
      qb.andWhere('t.publish_status = :ps', { ps: publishStatus });
    }

    qb.orderBy('t.updated_at', 'DESC').addOrderBy('t.created_at', 'DESC');

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: rows.map(toMaintenanceTaskListItem),
      total,
      page,
      page_size: pageSize,
    };
  }

  async getTaskById(id: string): Promise<MaintenanceTask> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Maintenance task '${id}' not found`);
    }
    return row;
  }

  async getTaskDetail(id: string): Promise<{
    task_id: string;
    name: string;
    publish_status: string;
    usage_status: string;
    body: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }> {
    const row = await this.getTaskById(id);
    return {
      task_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      usage_status: row.usageStatus,
      body: await this.withResolvedFacilities(row.body ?? {}),
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async isTaskNameUnique(
    name: string,
    excludeTaskId?: string,
  ): Promise<boolean> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || trimmed === UNTITLED_MAINTENANCE_TASK_NAME) return true;

    const qb = this.repo
      .createQueryBuilder('t')
      .where('LOWER(t.name) = LOWER(:name)', { name: trimmed });

    if (excludeTaskId) {
      qb.andWhere('t.task_id != :excludeId', { excludeId: excludeTaskId });
    }

    const existing = await qb.getOne();
    return !existing;
  }

  async createDraft(
    input: SaveMaintenanceTaskDraftInput,
  ): Promise<MaintenanceTaskListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isTaskNameUnique(name))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const now = String(Date.now());
    const row = this.repo.create({
      id: this.generateTaskId(),
      name,
      publishStatus: MaintenanceTaskPublishStatus.DRAFT,
      usageStatus: MaintenanceTaskUsageStatus.IDLE,
      body: await this.withResolvedFacilities(input.body ?? {}, 'write'),
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toMaintenanceTaskListItem(saved);
  }

  async updateDraft(
    id: string,
    input: SaveMaintenanceTaskDraftInput,
  ): Promise<MaintenanceTaskListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isTaskNameUnique(name, id))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const row = await this.getTaskById(id);
    row.name = name;
    row.body = await this.withResolvedFacilities(input.body ?? {}, 'write');
    row.updatedAt = String(Date.now());

    const saved = await this.repo.save(row);
    return toMaintenanceTaskListItem(saved);
  }

  async deleteTask(id: string): Promise<void> {
    const row = await this.getTaskById(id);
    if (row.usageStatus === MaintenanceTaskUsageStatus.IN_USE) {
      throw new BadRequestException('使用中的整備任務無法刪除');
    }
    await this.repo.delete({ id });
  }

  private generateTaskId(): string {
    const suffix = Date.now().toString(36).toUpperCase().slice(-8);
    return `MT-DRAFT-${suffix}`;
  }

  private resolveDraftName(name: string | undefined): string {
    const trimmed = String(name ?? '').trim();
    return trimmed || UNTITLED_MAINTENANCE_TASK_NAME;
  }
}
