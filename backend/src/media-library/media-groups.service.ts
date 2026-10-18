import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { MediaLibraryItem, MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import {
  groupMediaIds,
  groupPlayability,
  memberSummary,
  mediaUnavailableReason,
  UNAVAILABLE_LABEL,
  type MediaBody,
} from './media-availability';
import { MediaStorageService } from './media-storage.service';

export const GROUP_NAME_MAX = 60;
/** 一個分組最多幾個成員；一次最多加入幾個 */
export const GROUP_MEMBER_MAX = 100;
export const GROUP_ADD_MAX = 30;
const PAGE_SIZE_MAX = 50;
export const MEDIA_LIBRARY_TAG = 'table:media_library_items';

export type GroupReference = { kind: 'schedule' | 'shift' | 'time_template' | 'maintenance_task'; id: string; name: string };

const REFERENCE_LABEL: Record<GroupReference['kind'], string> = {
  schedule: '媒體排程',
  shift: '班表',
  time_template: '時間模板',
  maintenance_task: '整備任務',
};

/**
 * 媒體分組（media_library_items.kind='group'，成員順序存在 body.mediaIds）。
 *
 * <h3>一致性規則</h3>
 * - 每次寫入都在交易內，以 row_version 做樂觀鎖：請求帶上讀到的版本，不符就 409，版本每次寫入都 +1
 *   （不靠 updated_at，同一毫秒的兩次寫入也分得出來）。
 * - 鎖定順序固定「先媒體、後分組」：加入／排序先以 FOR SHARE 鎖住會寫進去的媒體列，再 FOR UPDATE 鎖分組。
 *   媒體永久刪除是「先鎖媒體 FOR UPDATE、再鎖含它的分組」，兩邊順序一致不會互鎖；刪除完成後，
 *   等在 FOR SHARE 的加入／排序會看到媒體已不存在而失敗，不會把失效 ID 寫回去。
 * - 更名只改 name，不動 body.mediaIds；成員異動只改 body.mediaIds。
 */
@Injectable()
export class MediaGroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: MediaStorageService,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  async list(args: { keyword?: string; page?: number; page_size?: number; sort_direction?: string }) {
    const page = Math.max(1, Math.floor(Number(args.page)) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(args.page_size)) || 10));
    const direction = args.sort_direction === 'desc' ? 'DESC' : 'ASC';
    const repo = this.dataSource.getRepository(MediaLibraryItem);
    const qb = repo.createQueryBuilder('g').where('g.kind = :kind', { kind: MediaLibraryKind.GROUP });
    const keyword = args.keyword?.trim();
    if (keyword) qb.andWhere('g.name ILIKE :kw', { kw: `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });
    // 同名時依 id 排，分頁穩定
    qb.orderBy('g.name', direction).addOrderBy('g.id', 'ASC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    const members = await this.loadMembers(rows.flatMap(groupMediaIds));
    return { items: rows.map((row) => this.present(row, members)), total, page, page_size: pageSize };
  }

  async get(id: string) {
    const row = await this.findGroup(this.dataSource.manager, id);
    return this.present(row, await this.loadMembers(groupMediaIds(row)));
  }

  /** 加入媒體的候選：只有單一媒體（kind=media），標出已在分組內與無法加入的原因 */
  async candidates(args: { group_id?: string; keyword?: string; page?: number; page_size?: number }) {
    const group = await this.findGroup(this.dataSource.manager, String(args.group_id ?? ''));
    const inGroup = new Set(groupMediaIds(group));
    const page = Math.max(1, Math.floor(Number(args.page)) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(args.page_size)) || 6));
    const qb = this.dataSource.getRepository(MediaLibraryItem).createQueryBuilder('m').where('m.kind = :kind', { kind: MediaLibraryKind.MEDIA });
    const keyword = args.keyword?.trim();
    if (keyword) qb.andWhere("(m.name ILIKE :kw OR COALESCE(m.body->>'description', '') ILIKE :kw)", { kw: `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });
    qb.orderBy('m.name', 'ASC').addOrderBy('m.id', 'ASC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return {
      group: { id: group.id, version: group.version, member_count: inGroup.size },
      items: rows.map((row) => ({ ...memberSummary(row), in_group: inGroup.has(row.id) })),
      total,
      page,
      page_size: pageSize,
      limits: { member_max: GROUP_MEMBER_MAX, add_max: GROUP_ADD_MAX },
    };
  }

  async create(input: { name?: unknown }) {
    const name = this.validName(input.name);
    const row = await this.dataSource.transaction(async (manager) => {
      await this.lockNames(manager);
      await this.assertNameFree(manager, name);
      const now = String(Date.now());
      const created = manager.create(MediaLibraryItem, {
        id: `MGR-${randomUUID()}`,
        name,
        kind: MediaLibraryKind.GROUP,
        body: { mediaIds: [] },
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      return manager.save(created);
    });
    this.changed('media_group_created');
    return this.present(row, new Map());
  }

  async rename(id: string, input: { name?: unknown; expected_version?: unknown }) {
    const name = this.validName(input.name);
    const expected = this.version(input.expected_version);
    await this.dataSource.transaction(async (manager) => {
      await this.lockNames(manager);
      const group = await this.lockGroup(manager, id, expected);
      if (group.name === name) throw new BadRequestException('名稱沒有變更');
      await this.assertNameFree(manager, name, id);
      // 只改名稱：成員清單由資料庫現值保留，不用表單帶來的舊成員覆蓋
      await this.write(manager, group, { name });
    });
    this.changed('media_group_renamed');
    return this.get(id);
  }

  async addMembers(id: string, input: { media_ids?: unknown; expected_version?: unknown }) {
    const expected = this.version(input.expected_version);
    const ids = this.idList(input.media_ids);
    if (ids.length === 0) throw new BadRequestException('請選擇要加入的媒體');
    if (ids.length > GROUP_ADD_MAX) throw new BadRequestException(`一次最多加入 ${GROUP_ADD_MAX} 個媒體`);
    await this.dataSource.transaction(async (manager) => {
      const media = await this.lockMedia(manager, ids);
      const group = await this.lockGroup(manager, id, expected);
      const current = groupMediaIds(group);
      const duplicate = ids.filter((mediaId) => current.includes(mediaId));
      if (duplicate.length) throw new ConflictException(`已在分組內：${duplicate.map((mediaId) => media.get(mediaId)?.name ?? mediaId).join('、')}`);
      for (const mediaId of ids) {
        const row = media.get(mediaId);
        if (!row) throw new ConflictException('部分媒體已不存在，請重新取得清單');
        if (row.kind !== MediaLibraryKind.MEDIA) throw new BadRequestException('分組不能加入其他分組');
        const reason = mediaUnavailableReason(row);
        if (reason) throw new BadRequestException(`「${row.name}」無法加入：${UNAVAILABLE_LABEL[reason]}`);
        const file = (row.body as MediaBody).file;
        if (file?.storageKey) {
          try {
            await this.storage.assertReadable(file.storageKey);
          } catch {
            throw new BadRequestException(`「${row.name}」無法加入：檔案遺失或無法讀取`);
          }
        }
      }
      if (current.length + ids.length > GROUP_MEMBER_MAX) throw new BadRequestException(`分組最多 ${GROUP_MEMBER_MAX} 個媒體（目前 ${current.length} 個）`);
      // 依請求順序（使用者勾選順序）附加在最後
      await this.write(manager, group, { mediaIds: [...current, ...ids] });
    });
    this.changed('media_group_members_added');
    return this.get(id);
  }

  async removeMember(id: string, mediaId: string, expectedRaw: unknown) {
    const expected = this.version(expectedRaw);
    await this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(manager, id, expected);
      const current = groupMediaIds(group);
      if (!current.includes(mediaId)) throw new ConflictException('這個媒體已不在分組內，請重新整理');
      // 只移除這個分組的引用；媒體主檔與其他分組不動
      await this.write(manager, group, { mediaIds: current.filter((item) => item !== mediaId) });
    });
    this.changed('media_group_member_removed');
    return this.get(id);
  }

  async reorder(id: string, input: { media_ids?: unknown; expected_version?: unknown }) {
    const expected = this.version(input.expected_version);
    const ids = this.idList(input.media_ids);
    await this.dataSource.transaction(async (manager) => {
      const media = await this.lockMedia(manager, ids);
      const group = await this.lockGroup(manager, id, expected);
      const current = groupMediaIds(group);
      const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((item) => current.includes(item));
      if (!same) throw new ConflictException('成員清單已變更，請重新整理後再排序');
      if (ids.some((item) => !media.has(item))) throw new ConflictException('部分媒體已不存在，請重新整理後再排序');
      await this.write(manager, group, { mediaIds: ids });
    });
    this.changed('media_group_reordered');
    return this.get(id);
  }

  async deleteImpact(id: string) {
    const group = await this.findGroup(this.dataSource.manager, id);
    const references = await this.references(this.dataSource.manager, id);
    return {
      id: group.id,
      name: group.name,
      version: group.version,
      member_count: groupMediaIds(group).length,
      references: references.map((ref) => ({ ...ref, kind_label: REFERENCE_LABEL[ref.kind] })),
      allowed: references.length === 0,
    };
  }

  async remove(id: string, expectedRaw: unknown) {
    const expected = this.version(expectedRaw);
    await this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, id, expected);
      // 確認時再檢查一次引用：預覽之後才加上的關聯也擋得住
      const references = await this.references(manager, id);
      if (references.length)
        throw new ConflictException(`分組仍被引用，請先解除：${references.map((ref) => `${REFERENCE_LABEL[ref.kind]}「${ref.name}」`).join('、')}`);
      // 只刪分組本身（成員關係存在分組裡，一起消失）；不碰媒體主檔與檔案
      await manager.delete(MediaLibraryItem, { id, kind: MediaLibraryKind.GROUP });
    });
    this.changed('media_group_deleted');
    return { deleted: true };
  }

  /** 直接引用這個分組的地方：媒體排程，以及班表／時間模板／整備任務設定內容中出現的分組 ID */
  async references(manager: EntityManager, id: string): Promise<GroupReference[]> {
    const rows = await manager.query<Array<{ kind: GroupReference['kind']; id: string; name: string }>>(
      `SELECT 'schedule' AS kind, id::text AS id, name FROM media_schedules WHERE media_id = $1
       UNION ALL
       SELECT 'shift', shift_id, name FROM operation_shifts WHERE jsonb_path_exists(body, '$.** ? (@ == $id)', jsonb_build_object('id', $1::text))
       UNION ALL
       SELECT 'time_template', template_id, name FROM time_templates WHERE jsonb_path_exists(body, '$.** ? (@ == $id)', jsonb_build_object('id', $1::text))
       UNION ALL
       SELECT 'maintenance_task', task_id, name FROM maintenance_tasks WHERE jsonb_path_exists(body, '$.** ? (@ == $id)', jsonb_build_object('id', $1::text))`,
      [id],
    );
    return rows;
  }

  private present(row: MediaLibraryItem, members: Map<string, MediaLibraryItem>) {
    const ids = groupMediaIds(row);
    const playability = groupPlayability(ids, members);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      updated_at: row.updatedAt,
      member_count: ids.length,
      // 依保存順序；已不存在的成員照樣列出並標示，不補造
      members: ids.map((mediaId) => {
        const media = members.get(mediaId);
        return media && media.kind === MediaLibraryKind.MEDIA
          ? { ...memberSummary(media), missing: false }
          : { id: mediaId, name: null, media_type: null, description: '', text_excerpt: null, original_name: null, available: false, unavailable_reason: 'missing', unavailable_label: '媒體已不存在', updated_at: null, missing: true };
      }),
      playable: playability.playable,
      unavailable_reason: playability.reason,
      unavailable_label: playability.label,
    };
  }

  /** 成員批次讀取（一次查完，不逐筆） */
  private async loadMembers(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, MediaLibraryItem>();
    const rows = await this.dataSource.getRepository(MediaLibraryItem).find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async findGroup(manager: EntityManager, id: string) {
    const row = await manager.findOne(MediaLibraryItem, { where: { id, kind: MediaLibraryKind.GROUP } });
    if (!row) throw new NotFoundException('找不到媒體分組');
    return row;
  }

  private async lockGroup(manager: EntityManager, id: string, expected: number) {
    const row = await manager
      .getRepository(MediaLibraryItem)
      .createQueryBuilder('g')
      .setLock('pessimistic_write')
      .where('g.id = :id AND g.kind = :kind', { id, kind: MediaLibraryKind.GROUP })
      .getOne();
    if (!row) throw new NotFoundException('找不到媒體分組，可能已被刪除');
    if (row.version !== expected) throw new ConflictException('分組已被其他使用者修改，請重新整理後再操作');
    return row;
  }

  /** 依 id 排序後 FOR SHARE：阻擋同時進行的永久刪除，鎖定順序固定避免互鎖 */
  private async lockMedia(manager: EntityManager, ids: string[]) {
    if (!ids.length) return new Map<string, MediaLibraryItem>();
    const rows = await manager
      .getRepository(MediaLibraryItem)
      .createQueryBuilder('m')
      .setLock('pessimistic_read')
      .where('m.id IN (:...ids)', { ids: [...new Set(ids)].sort() })
      .orderBy('m.id', 'ASC')
      .getMany();
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async write(manager: EntityManager, group: MediaLibraryItem, change: { name?: string; mediaIds?: string[] }) {
    const body = change.mediaIds ? { ...(group.body as MediaBody), mediaIds: change.mediaIds } : group.body;
    if (change.mediaIds) delete (body as MediaBody).unavailableReason;
    const result = await manager
      .createQueryBuilder()
      .update(MediaLibraryItem)
      .set({ ...(change.name ? { name: change.name } : {}), body: body as MediaLibraryItem['body'], version: () => 'row_version + 1', updatedAt: String(Date.now()) })
      .where('media_id = :id AND row_version = :version', { id: group.id, version: group.version })
      .execute();
    if (!result.affected) throw new ConflictException('分組已被其他使用者修改，請重新整理後再操作');
  }

  /** 名稱檢查與寫入序列化（避免兩個人同時建立同名分組） */
  private async lockNames(manager: EntityManager) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('media-group-names'))`);
  }

  private async assertNameFree(manager: EntityManager, name: string, exceptId?: string) {
    const [row] = await manager.query<Array<{ media_id: string }>>(
      `SELECT media_id FROM media_library_items WHERE kind = 'group' AND lower(btrim(name)) = lower($1) AND ($2::text IS NULL OR media_id <> $2) LIMIT 1`,
      [name, exceptId ?? null],
    );
    if (row) throw new ConflictException('已有相同名稱的分組');
  }

  private validName(raw: unknown) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw new BadRequestException('請輸入分組名稱');
    if (name.length > GROUP_NAME_MAX) throw new BadRequestException(`分組名稱最多 ${GROUP_NAME_MAX} 字`);
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new BadRequestException('分組名稱不能包含控制字元');
    return name;
  }

  private version(raw: unknown) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new BadRequestException('缺少分組版本，請重新整理');
    return value;
  }

  private idList(raw: unknown) {
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || !item.trim())) throw new BadRequestException('媒體清單格式不正確');
    const ids = raw.map((item: string) => item.trim());
    if (new Set(ids).size !== ids.length) throw new BadRequestException('媒體清單有重複項目');
    return ids;
  }

  private changed(reason: string) {
    this.invalidation?.emit([MEDIA_LIBRARY_TAG], reason);
  }
}
