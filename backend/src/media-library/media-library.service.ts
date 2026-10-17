import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { MediaLibraryItem, MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { MediaSchedule } from '../database/entities/media-schedule.entity';
import { MediaStorageService, MediaType, StoredMediaFile, UploadedMediaFile } from './media-storage.service';

export type MediaLibraryOption = { id: string; name: string; kind: MediaLibraryKind };
type MediaBody = { mediaType?: MediaType; description?: string; textContent?: string; file?: StoredMediaFile; mediaIds?: string[]; unavailableReason?: string };
type MutationInput = { name?: string; description?: string; mediaType?: string; textContent?: string; expectedUpdatedAt?: string };
const NAME_MAX = 120, DESCRIPTION_MAX = 500, TEXT_MAX = 10_000;

@Injectable()
export class MediaLibraryService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(MediaLibraryItem) private readonly repo: Repository<MediaLibraryItem>,
    @InjectRepository(MediaSchedule) private readonly schedules: Repository<MediaSchedule>,
    private readonly dataSource: DataSource,
    private readonly storage: MediaStorageService,
  ) {}

  async onApplicationBootstrap() {
    const rows = await this.repo.find({ where: { kind: MediaLibraryKind.MEDIA } });
    const keys = new Set(rows.map((row) => (row.body as MediaBody).file?.storageKey).filter((key): key is string => Boolean(key)));
    await this.storage.removeOrphans(keys);
  }

  async listOptions(): Promise<{ items: MediaLibraryOption[] }> {
    const rows = await this.repo.find({ order: { kind: 'ASC', name: 'ASC' } });
    return { items: rows.filter((row) => row.kind !== MediaLibraryKind.GROUP || ((row.body as MediaBody).mediaIds?.length ?? 0) > 0).map((row) => ({ id: row.id, name: row.name, kind: row.kind })) };
  }

  async listItems(args: { keyword?: string; kind?: MediaLibraryKind | 'all'; page?: number; page_size?: number; sort_by?: string; sort_direction?: string }) {
    const page = Math.max(1, Number.isFinite(args.page) ? args.page! : 1);
    const pageSize = Math.min(100, Math.max(1, Number.isFinite(args.page_size) ? args.page_size! : 20));
    const qb = this.repo.createQueryBuilder('m');
    if (args.keyword?.trim()) qb.andWhere("(m.name ILIKE :kw OR COALESCE(m.body->>'description', '') ILIKE :kw)", { kw: `%${args.keyword.trim()}%` });
    if (args.kind === MediaLibraryKind.MEDIA || args.kind === MediaLibraryKind.GROUP) qb.andWhere('m.kind = :kind', { kind: args.kind });
    const sortMap: Record<string, string> = { name: 'm.name', mediaType: "m.body->>'mediaType'", description: "m.body->>'description'", createdAt: 'm.createdAt', updatedAt: 'm.updatedAt' };
    qb.orderBy(sortMap[args.sort_by ?? 'name'] ?? sortMap.name, args.sort_direction === 'desc' ? 'DESC' : 'ASC').addOrderBy('m.id', 'ASC');
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: items.map((row) => this.present(row)), total, page, page_size: pageSize };
  }

  async get(id: string) { return this.present(await this.findMedia(id)); }

  async create(input: MutationInput, file?: UploadedMediaFile) {
    const data = this.validate(input, file);
    let stored: StoredMediaFile | undefined;
    try {
      if (file && data.mediaType !== 'text') stored = await this.storage.store(file, data.mediaType);
      const now = String(Date.now());
      const row = this.repo.create({ id: `MED-${randomUUID()}`, name: data.name, kind: MediaLibraryKind.MEDIA, body: { mediaType: data.mediaType, description: data.description, ...(data.mediaType === 'text' ? { textContent: data.textContent } : { file: stored }) }, createdAt: now, updatedAt: now });
      return this.present(await this.repo.save(row));
    } catch (error) {
      if (stored) await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  async update(id: string, input: MutationInput, file?: UploadedMediaFile) {
    const current = await this.findMedia(id);
    if (input.expectedUpdatedAt !== current.updatedAt) throw new ConflictException('媒體已被其他使用者修改，請重新載入');
    const oldBody = current.body as MediaBody;
    const data = this.validate({ name: input.name ?? current.name, description: input.description ?? oldBody.description, mediaType: input.mediaType ?? oldBody.mediaType, textContent: input.textContent ?? oldBody.textContent }, file, true, oldBody);
    if (data.mediaType !== oldBody.mediaType && (await this.referenceImpact(id)).hasReferences) throw new ConflictException('媒體已被分組或排程引用，不能變更檔案類型');
    let stored: StoredMediaFile | undefined;
    try {
      if (file && data.mediaType !== 'text') stored = await this.storage.store(file, data.mediaType);
      const body: MediaBody = { mediaType: data.mediaType, description: data.description };
      if (data.mediaType === 'text') body.textContent = data.textContent;
      else body.file = stored ?? (data.mediaType === oldBody.mediaType ? oldBody.file : undefined);
      if (!body.file && data.mediaType !== 'text') throw new BadRequestException('請選擇要上傳的檔案');
      const result = await this.repo.createQueryBuilder().update(MediaLibraryItem).set({ name: data.name, body: body as any, updatedAt: String(Date.now()) }).where('media_id = :id AND updated_at = :updatedAt', { id, updatedAt: current.updatedAt }).execute();
      if (!result.affected) throw new ConflictException('媒體已被其他使用者修改，請重新載入');
      if (stored && oldBody.file?.storageKey) await this.storage.remove(oldBody.file.storageKey);
      return this.get(id);
    } catch (error) {
      if (stored) await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  async deleteImpact(id: string) {
    const item = await this.findMedia(id), impact = await this.referenceImpact(id);
    return { id, name: item.name, updated_at: item.updatedAt, ...impact, allowed: impact.schedules.length === 0 };
  }

  async remove(id: string, expectedUpdatedAt?: string) {
    const current = await this.findMedia(id);
    if (!expectedUpdatedAt || expectedUpdatedAt !== current.updatedAt) throw new ConflictException('刪除預覽已過期，請重新確認');
    const body = current.body as MediaBody;
    let affectedGroups: string[] = [];
    await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const itemRepo = manager.getRepository(MediaLibraryItem);
      const locked = await itemRepo.createQueryBuilder('m').setLock('pessimistic_write').where('m.media_id = :id', { id }).getOne();
      if (!locked || locked.updatedAt !== expectedUpdatedAt) throw new ConflictException('刪除預覽已過期，請重新確認');
      const schedules = await manager.getRepository(MediaSchedule).find({ where: { mediaId: id }, select: { id: true, name: true } });
      if (schedules.length) throw new ConflictException(`媒體仍被排程引用：${schedules.map((row) => row.name).join('、')}`);
      const groups = await itemRepo.find({ where: { kind: MediaLibraryKind.GROUP } });
      const touched = groups.filter((group) => ((group.body as MediaBody).mediaIds ?? []).includes(id));
      affectedGroups = touched.map((group) => group.name);
      for (const group of touched) {
        const groupBody = group.body as MediaBody;
        const mediaIds = (groupBody.mediaIds ?? []).filter((mediaId) => mediaId !== id);
        group.body = { ...groupBody, mediaIds, ...(mediaIds.length ? {} : { unavailableReason: 'empty' }) };
        group.updatedAt = String(Date.now());
        await itemRepo.save(group);
      }
      await itemRepo.delete(id);
    });
    const fileRemoved = await this.storage.remove(body.file?.storageKey);
    return { deleted: true, affected_groups: affectedGroups, file_cleanup_pending: !fileRemoved };
  }

  async file(id: string) {
    const row = await this.findMedia(id), body = row.body as MediaBody;
    if (!body.file?.storageKey) throw new NotFoundException('此媒體尚無實體檔案');
    try { return { ...(await this.storage.assertReadable(body.file.storageKey)), metadata: body.file }; }
    catch { throw new NotFoundException('媒體檔案遺失或無法讀取'); }
  }

  private async findMedia(id: string) {
    const row = await this.repo.findOne({ where: { id, kind: MediaLibraryKind.MEDIA } });
    if (!row) throw new NotFoundException('找不到媒體');
    return row;
  }
  private async referenceImpact(id: string) {
    const [groups, schedules] = await Promise.all([this.repo.find({ where: { kind: MediaLibraryKind.GROUP } }), this.schedules.find({ where: { mediaId: id }, select: { id: true, name: true } })]);
    const referencedGroups = groups.filter((group) => ((group.body as MediaBody).mediaIds ?? []).includes(id)).map((group) => ({ id: group.id, name: group.name }));
    return { groups: referencedGroups, schedules: schedules.map((row) => ({ id: row.id, name: row.name })), hasReferences: referencedGroups.length > 0 || schedules.length > 0 };
  }
  private validate(input: MutationInput, file?: UploadedMediaFile, editing = false, current?: MediaBody) {
    const name = input.name?.trim() ?? '', description = input.description?.trim() ?? '', mediaType = input.mediaType as MediaType, textContent = input.textContent ?? '';
    if (!name || name.length > NAME_MAX) throw new BadRequestException(`檔案名稱必須為 1–${NAME_MAX} 字`);
    if (!description || description.length > DESCRIPTION_MAX) throw new BadRequestException(`內容描述必須為 1–${DESCRIPTION_MAX} 字`);
    if (!['audio', 'text', 'image', 'video'].includes(mediaType)) throw new BadRequestException('請選擇有效的檔案類型');
    if (mediaType === 'text' && (!textContent.trim() || textContent.length > TEXT_MAX)) throw new BadRequestException(`媒體文字必須為 1–${TEXT_MAX} 字`);
    if (mediaType !== 'text' && !file && !(editing && current?.mediaType === mediaType && current.file)) throw new BadRequestException('請選擇要上傳的檔案');
    return { name, description, mediaType, textContent };
  }
  private present(row: MediaLibraryItem) {
    const body = row.body as MediaBody;
    return { id: row.id, name: row.name, kind: row.kind, media_type: body.mediaType ?? null, description: body.description ?? '', text_content: body.textContent, file: body.file ? { original_name: body.file.originalName, mime_type: body.file.mimeType, size_bytes: body.file.sizeBytes, sha256: body.file.sha256, duration_seconds: body.file.durationSeconds, width: body.file.width, height: body.file.height, status: body.file.status, content_url: `/syncdrive-api/media-library/${encodeURIComponent(row.id)}/content` } : null, file_status: row.kind === MediaLibraryKind.MEDIA && !body.file && !body.textContent ? 'missing' : 'ready', created_at: row.createdAt, updated_at: row.updatedAt };
  }
}
