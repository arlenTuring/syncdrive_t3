import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

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
      qb.andWhere('(t.task_id ILIKE :kw OR t.name ILIKE :kw)', { kw: `%${keyword}%` });
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
      body: row.body ?? {},
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async isTaskNameUnique(name: string, excludeTaskId?: string): Promise<boolean> {
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

  async createDraft(input: SaveMaintenanceTaskDraftInput): Promise<MaintenanceTaskListItem> {
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
      body: input.body ?? {},
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toMaintenanceTaskListItem(saved);
  }

  async updateDraft(id: string, input: SaveMaintenanceTaskDraftInput): Promise<MaintenanceTaskListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isTaskNameUnique(name, id))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const row = await this.getTaskById(id);
    row.name = name;
    row.body = input.body ?? {};
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
