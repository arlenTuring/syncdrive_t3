import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TimeTemplate,
  TimeTemplatePublishStatus,
  TimeTemplateUsageStatus,
} from '../database/entities/time-template.entity';
import {
  toTimeTemplateListItem,
  type TimeTemplateListItem,
} from './time-template-list.util';

export type ListTimeTemplatesQuery = {
  keyword?: string;
  publish_status?: 'all' | TimeTemplatePublishStatus;
  page?: number;
  page_size?: number;
};

export type CreateTimeTemplateDraftInput = {
  name: string;
  body?: Record<string, unknown>;
};

export type UpdateTimeTemplateDraftInput = {
  name: string;
  body?: Record<string, unknown>;
};

const UNTITLED_DRAFT_NAME = '未完成的時間模板';

@Injectable()
export class TimeTemplateService {
  constructor(
    @InjectRepository(TimeTemplate)
    private readonly repo: Repository<TimeTemplate>,
  ) {}

  async listTemplates(query: ListTimeTemplatesQuery): Promise<{
    items: TimeTemplateListItem[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));

    const qb = this.repo.createQueryBuilder('t');

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      qb.andWhere('(t.template_id ILIKE :kw OR t.name ILIKE :kw)', { kw: `%${keyword}%` });
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
      items: rows.map(toTimeTemplateListItem),
      total,
      page,
      page_size: pageSize,
    };
  }

  async exportTemplates(ids: string[]): Promise<
    Array<{
      template_id: string;
      name: string;
      publish_status: string;
      usage_status: string;
      body: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>
  > {
    const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const rows = await this.repo.find({
      where: { id: In(uniqueIds) },
      order: { updatedAt: 'DESC' },
    });

    return rows.map((row) => ({
      template_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      usage_status: row.usageStatus,
      body: row.body ?? {},
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  async getTemplateById(id: string): Promise<TimeTemplate> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Time template '${id}' not found`);
    }
    return row;
  }

  async getTemplateDetail(id: string): Promise<{
    template_id: string;
    name: string;
    publish_status: string;
    usage_status: string;
    body: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }> {
    const row = await this.getTemplateById(id);
    return {
      template_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      usage_status: row.usageStatus,
      body: row.body ?? {},
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async createDraft(input: CreateTimeTemplateDraftInput): Promise<TimeTemplateListItem> {
    const name = this.resolveDraftName(input.name);

    const now = String(Date.now());
    const row = this.repo.create({
      id: this.generateTemplateId(),
      name,
      publishStatus: TimeTemplatePublishStatus.DRAFT,
      usageStatus: TimeTemplateUsageStatus.IDLE,
      body: input.body ?? {},
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toTimeTemplateListItem(saved);
  }

  async updateDraft(id: string, input: UpdateTimeTemplateDraftInput): Promise<TimeTemplateListItem> {
    const name = this.resolveDraftName(input.name);

    const row = await this.getTemplateById(id);
    row.name = name;
    row.body = input.body ?? {};
    row.updatedAt = String(Date.now());

    const saved = await this.repo.save(row);
    return toTimeTemplateListItem(saved);
  }

  async deleteTemplate(id: string): Promise<void> {
    const row = await this.getTemplateById(id);
    if (row.usageStatus === TimeTemplateUsageStatus.IN_USE) {
      throw new BadRequestException('使用中的模板無法刪除');
    }
    await this.repo.delete({ id });
  }

  /** 複製為新草稿：名稱為原名＋「 複製模板」；發布／使用狀態重置 */
  async duplicateAsNewDraft(id: string): Promise<TimeTemplateListItem> {
    const source = await this.getTemplateById(id);
    const baseName = source.name.trim() || UNTITLED_DRAFT_NAME;
    const name = `${baseName} 複製模板`;
    const body = JSON.parse(JSON.stringify(source.body ?? {})) as Record<string, unknown>;

    const now = String(Date.now());
    const row = this.repo.create({
      id: this.generateTemplateId(),
      name,
      publishStatus: TimeTemplatePublishStatus.DRAFT,
      usageStatus: TimeTemplateUsageStatus.IDLE,
      body,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toTimeTemplateListItem(saved);
  }

  private generateTemplateId(): string {
    const suffix = Date.now().toString(36).toUpperCase().slice(-8);
    return `TT-DRAFT-${suffix}`;
  }

  /** 標題非唯一；空標題以預設名稱存入 DB，主鍵仍為 template_id */
  private resolveDraftName(name: string | undefined): string {
    const trimmed = String(name ?? '').trim();
    return trimmed || UNTITLED_DRAFT_NAME;
  }
}
