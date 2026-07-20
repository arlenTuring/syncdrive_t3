import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';
import {
  toOperationShiftListItem,
  UNTITLED_OPERATION_SHIFT_NAME,
  type OperationShiftListItem,
} from './operation-shift-list.util';

export type ListOperationShiftsQuery = {
  keyword?: string;
  usage_status?: 'all' | OperationShiftUsageStatus;
  publish_status?: 'all' | OperationShiftPublishStatus;
  page?: number;
  page_size?: number;
};

export type SaveOperationShiftDraftInput = {
  name: string;
  body?: Record<string, unknown>;
};

@Injectable()
export class OperationShiftService {
  constructor(
    @InjectRepository(OperationShift)
    private readonly repo: Repository<OperationShift>,
  ) {}

  async listShifts(query: ListOperationShiftsQuery): Promise<{
    items: OperationShiftListItem[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));

    const qb = this.repo.createQueryBuilder('s');

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      qb.andWhere('(s.shift_id ILIKE :kw OR s.name ILIKE :kw)', { kw: `%${keyword}%` });
    }

    const usageStatus = query.usage_status;
    if (usageStatus && usageStatus !== 'all') {
      qb.andWhere('s.usage_status = :us', { us: usageStatus });
    }

    const publishStatus = query.publish_status;
    if (publishStatus && publishStatus !== 'all') {
      qb.andWhere('s.publish_status = :ps', { ps: publishStatus });
    }

    qb.orderBy('s.updated_at', 'DESC').addOrderBy('s.created_at', 'DESC');

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: rows.map(toOperationShiftListItem),
      total,
      page,
      page_size: pageSize,
    };
  }

  async getShiftById(id: string): Promise<OperationShift> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Operation shift '${id}' not found`);
    }
    return row;
  }

  async getShiftDetail(id: string): Promise<{
    shift_id: string;
    name: string;
    publish_status: string;
    usage_status: string;
    body: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }> {
    const row = await this.getShiftById(id);
    return {
      shift_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      usage_status: row.usageStatus,
      body: row.body ?? {},
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async isShiftNameUnique(name: string, excludeShiftId?: string): Promise<boolean> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || trimmed === UNTITLED_OPERATION_SHIFT_NAME) return true;

    const qb = this.repo
      .createQueryBuilder('s')
      .where('LOWER(s.name) = LOWER(:name)', { name: trimmed });

    if (excludeShiftId) {
      qb.andWhere('s.shift_id != :excludeId', { excludeId: excludeShiftId });
    }

    const existing = await qb.getOne();
    return !existing;
  }

  async createDraft(input: SaveOperationShiftDraftInput): Promise<OperationShiftListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isShiftNameUnique(name))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const now = String(Date.now());
    const row = this.repo.create({
      id: this.generateShiftId(),
      name,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body: input.body ?? {},
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async updateDraft(id: string, input: SaveOperationShiftDraftInput): Promise<OperationShiftListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isShiftNameUnique(name, id))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const row = await this.getShiftById(id);
    row.name = name;
    row.body = input.body ?? {};
    row.updatedAt = String(Date.now());

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async duplicateAsNewDraft(id: string): Promise<OperationShiftListItem> {
    const source = await this.getShiftById(id);
    const baseName = source.name.trim() || UNTITLED_OPERATION_SHIFT_NAME;
    let candidate = `${baseName}（複製）`;
    let suffix = 2;
    while (!(await this.isShiftNameUnique(candidate))) {
      candidate = `${baseName}（複製 ${suffix}）`;
      suffix += 1;
    }

    const now = String(Date.now());
    const body = { ...(source.body ?? {}) };
    const row = this.repo.create({
      id: this.generateShiftId(),
      name: candidate,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  /**
   * 參數生成班表 → 複製成手動製作草稿。
   * 不修改來源資料；新草稿 body.creationMode = 'manual'。
   */
  async duplicateAsManualDraft(id: string): Promise<OperationShiftListItem> {
    const source = await this.getShiftById(id);
    const sourceBody = source.body ?? {};
    if (sourceBody.creationMode === 'manual') {
      throw new BadRequestException('手動製作的班表無法再複製成手動製作');
    }

    const baseName = source.name.trim() || UNTITLED_OPERATION_SHIFT_NAME;
    let candidate = `${baseName}(手動)`;
    let suffix = 2;
    while (!(await this.isShiftNameUnique(candidate))) {
      candidate = `${baseName}(手動 ${suffix})`;
      suffix += 1;
    }

    const now = String(Date.now());
    const body: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(sourceBody)) as Record<string, unknown>,
      creationMode: 'manual',
    };
    const row = this.repo.create({
      id: this.generateShiftId(),
      name: candidate,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async deleteShift(id: string): Promise<void> {
    const row = await this.getShiftById(id);
    if (row.usageStatus === OperationShiftUsageStatus.IN_USE) {
      throw new BadRequestException('使用中的班表無法刪除');
    }
    await this.repo.delete({ id });
  }

  private generateShiftId(): string {
    const suffix = Date.now().toString(36).toUpperCase().slice(-8);
    return `OS-DRAFT-${suffix}`;
  }

  private resolveDraftName(name: string | undefined): string {
    const trimmed = String(name ?? '').trim();
    return trimmed || UNTITLED_OPERATION_SHIFT_NAME;
  }
}
