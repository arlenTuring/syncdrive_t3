import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Account, AccountStatus } from '../database/entities/account.entity';
import { AccountRole } from '../database/entities/account-role.entity';
import { AccountSession } from '../database/entities/account-session.entity';
import { Permission } from '../database/entities/permission.entity';
import { PermissionChangeLog, PermissionChangeType, PermissionTargetType } from '../database/entities/permission-change-log.entity';
import { RolePermission } from '../database/entities/role-permission.entity';
import { Role } from '../database/entities/role.entity';
import { ADMIN_PERMISSIONS, validPassword } from './access.constants';
import { type AuthUser } from './auth.service';
import { AccountQueryDto, CreateAccountDto, RoleQueryDto, SaveRoleDto } from './access.dto';
import { hashPassword } from './password';

type AuditClient = { ip?: string };

@Injectable()
export class AccessService {
  constructor(private readonly dataSource: DataSource) {}

  async listAccounts(query: AccountQueryDto) {
    const sort = { account_name: 'a.account_name', display_name: 'a.display_name', roles: 'role_sort' }[query.sort_by];
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
    const keyword = query.keyword ? `%${query.keyword}%` : null;
    const offset = (query.page - 1) * query.page_size;
    const params = [keyword, query.page_size, offset];
    const filter = `a.deleted_at IS NULL AND ($1::text IS NULL OR a.account_name ILIKE $1 OR a.display_name ILIKE $1 OR EXISTS (
      SELECT 1 FROM account_roles ar2 JOIN roles r2 ON r2.id = ar2.role_id WHERE ar2.account_id = a.id AND r2.display_name ILIKE $1))`;
    const items = await this.dataSource.query(
      `SELECT a.id, a.account_name, a.display_name, a.status, a.created_at, a.updated_at,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'code', r.role_code, 'name', r.display_name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles,
        COALESCE(string_agg(DISTINCT r.display_name, '、' ORDER BY r.display_name), '') AS role_sort
       FROM accounts a LEFT JOIN account_roles ar ON ar.account_id = a.id LEFT JOIN roles r ON r.id = ar.role_id
       WHERE ${filter} GROUP BY a.id ORDER BY ${sort} ${direction}, a.id ASC LIMIT $2 OFFSET $3`, params,
    );
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM accounts a WHERE ${filter}`, [keyword]);
    return { items: items.map(({ role_sort: _roleSort, ...item }) => item), total: Number(total), page: query.page, page_size: query.page_size };
  }

  async createAccount(input: CreateAccountDto, actor: AuthUser, client: AuditClient) {
    if (!validPassword(input.password)) throw new BadRequestException('密碼須至少 8 字元並包含大小寫英文字母及數字');
    if (new Set(input.role_ids).size !== input.role_ids.length) throw new BadRequestException('角色不可重複');
    return this.dataSource.transaction(async (manager) => {
      const roles = await this.allowedRoles(manager, input.role_ids, actor);
      const now = Date.now();
      try {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext(lower($1)))`, [input.account_name]);
        if (await manager.createQueryBuilder(Account, 'a').where('LOWER(a.account_name)=LOWER(:name)', { name: input.account_name }).getExists()) {
          throw new ConflictException('帳號名稱已存在');
        }
        const account = await manager.save(Account, manager.create(Account, {
          accountName: input.account_name, displayName: input.display_name,
          passwordHash: await hashPassword(input.password), status: AccountStatus.ACTIVE,
          failedLoginCount: 0, createdAt: now, updatedAt: now,
        }));
        await manager.insert(AccountRole, roles.map((role) => ({ accountId: account.id, roleId: role.id, assignedBy: actor.id, createdAt: now })));
        await this.audit(manager, actor.id, PermissionTargetType.ACCOUNT, account.id, PermissionChangeType.CREATE, null,
          { account_name: account.accountName, display_name: account.displayName, role_ids: roles.map((r) => r.id) }, client.ip);
        await this.audit(manager, actor.id, PermissionTargetType.ACCOUNT_ROLE, account.id, PermissionChangeType.GRANT, null,
          { role_ids: roles.map((r) => r.id) }, client.ip);
        return this.publicAccount(account, roles);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('帳號名稱已存在');
        throw error;
      }
    });
  }

  async resetPassword(id: string, password: string, actor: AuthUser, client: AuditClient) {
    if (!validPassword(password)) throw new BadRequestException('密碼須至少 8 字元並包含大小寫英文字母及數字');
    await this.dataSource.transaction(async (manager) => {
      const account = await manager.findOne(Account, { where: { id } });
      if (!account || account.deletedAt) throw new NotFoundException('帳號不存在');
      await manager.update(Account, id, { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null, updatedAt: Date.now() });
      await manager.delete(AccountSession, { accountId: id });
      await this.audit(manager, actor.id, PermissionTargetType.ACCOUNT, id, PermissionChangeType.UPDATE,
        { password: '[REDACTED]' }, { password_reset: true, sessions_revoked: true }, client.ip);
    });
    return { reset: true, id };
  }

  async deleteAccount(id: string, actor: AuthUser, client: AuditClient) {
    if (id === actor.id) throw new ForbiddenException('不可刪除目前登入帳號');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('access-control-admin-guard'))`);
      const account = await manager.findOne(Account, { where: { id } });
      if (!account || account.deletedAt) throw new NotFoundException('帳號不存在');
      if (await this.isAdmin(manager, id)) {
        const count = await this.adminCount(manager);
        if (count <= 1) throw new ForbiddenException('不可刪除最後一個有效最高管理者');
      }
      const roles = await manager.findBy(AccountRole, { accountId: id });
      await manager.update(Account, id, { status: AccountStatus.DISABLED, deletedAt: Date.now(), updatedAt: Date.now() });
      await manager.delete(AccountSession, { accountId: id });
      await manager.delete(AccountRole, { accountId: id });
      await this.audit(manager, actor.id, PermissionTargetType.ACCOUNT, id, PermissionChangeType.DELETE,
        { account_name: account.accountName, display_name: account.displayName, role_ids: roles.map((r) => r.roleId) }, null, client.ip);
      return { deleted: true, id };
    });
  }

  async listRoles(query: RoleQueryDto) {
    const sort = { role_code: 'r.role_code', display_name: 'r.display_name', user_count: 'user_count' }[query.sort_by];
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
    const keyword = query.keyword ? `%${query.keyword}%` : null;
    const items = await this.dataSource.query(
      `SELECT r.id, r.role_code, r.display_name, r.description, r.is_system, r.created_at, r.updated_at,
        COUNT(DISTINCT ar.account_id)::int AS user_count,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'code', p.permission_code, 'name', p.display_name, 'module', p.module)) FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions
       FROM roles r LEFT JOIN account_roles ar ON ar.role_id = r.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE ($1::text IS NULL OR r.role_code ILIKE $1 OR r.display_name ILIKE $1)
       GROUP BY r.id ORDER BY ${sort} ${direction}, r.id ASC LIMIT $2 OFFSET $3`,
      [keyword, query.page_size, (query.page - 1) * query.page_size],
    );
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM roles r WHERE ($1::text IS NULL OR r.role_code ILIKE $1 OR r.display_name ILIKE $1)`, [keyword]);
    return { items, total: Number(total), page: query.page, page_size: query.page_size };
  }

  async roleOptions(actor: AuthUser) {
    const roles = await this.dataSource.query(
      `SELECT r.id, r.role_code AS code, r.display_name AS name, r.is_system,
        COALESCE(array_agg(p.permission_code) FILTER (WHERE p.permission_code IS NOT NULL), '{}') AS permission_codes
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id ORDER BY r.display_name`,
    );
    const mine = new Set(actor.permissions);
    return roles.filter((role: { permission_codes: string[] }) => role.permission_codes.every((p) => mine.has(p)));
  }

  async permissionDictionary() {
    return this.dataSource.query(`SELECT id, permission_code AS code, module, display_name AS name, description FROM permissions ORDER BY module, display_name`);
  }

  async role(id: string) {
    const [role] = await this.dataSource.query(
      `SELECT r.id, r.role_code, r.display_name, r.description, r.is_system, r.created_at, r.updated_at,
        COUNT(DISTINCT ar.account_id)::int AS user_count,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'code', p.permission_code, 'name', p.display_name, 'module', p.module)) FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions
       FROM roles r LEFT JOIN account_roles ar ON ar.role_id = r.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE r.id = $1 GROUP BY r.id`,
      [id],
    );
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async createRole(input: SaveRoleDto, actor: AuthUser, client: AuditClient) {
    const roleId = await this.dataSource.transaction(async (manager) => {
      const permissions = await this.allowedPermissions(manager, input.permission_ids, actor);
      const now = Date.now();
      try {
        const role = await manager.save(Role, manager.create(Role, {
          roleCode: input.role_code, displayName: input.display_name, description: input.description ?? '',
          isSystem: false, createdAt: now, updatedAt: now,
        }));
        if (permissions.length) await manager.insert(RolePermission, permissions.map((p) => ({ roleId: role.id, permissionId: p.id, createdAt: now })));
        await this.audit(manager, actor.id, PermissionTargetType.ROLE, role.id, PermissionChangeType.CREATE, null,
          { role_code: role.roleCode, display_name: role.displayName, description: role.description, permission_ids: permissions.map((p) => p.id) }, client.ip);
        return role.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('角色代號已存在');
        throw error;
      }
    });
    return this.role(roleId);
  }

  async updateRole(id: string, input: SaveRoleDto, actor: AuthUser, client: AuditClient) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('access-control-admin-guard'))`);
      const role = await manager.findOne(Role, { where: { id } });
      if (!role) throw new NotFoundException('角色不存在');
      if (input.role_code !== role.roleCode) throw new BadRequestException('角色代號為穩定識別，建立後不可變更');
      const permissions = await this.allowedPermissions(manager, input.permission_ids, actor);
      const beforeIds = (await manager.findBy(RolePermission, { roleId: id })).map((r) => r.permissionId);
      const before = { role_code: role.roleCode, display_name: role.displayName, description: role.description, permission_ids: beforeIds };
      try {
        await manager.update(Role, id, { displayName: input.display_name, description: input.description ?? '', updatedAt: Date.now() });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('角色代號已存在');
        throw error;
      }
      await manager.delete(RolePermission, { roleId: id });
      if (permissions.length) await manager.insert(RolePermission, permissions.map((p) => ({ roleId: id, permissionId: p.id, createdAt: Date.now() })));
      if (await this.adminCount(manager) < 1) throw new ForbiddenException('此修改會讓系統失去有效最高管理者');
      await this.audit(manager, actor.id, PermissionTargetType.ROLE, id, PermissionChangeType.UPDATE, before,
        { role_code: input.role_code, display_name: input.display_name, description: input.description ?? '', permission_ids: permissions.map((p) => p.id) }, client.ip);
      const added = permissions.map((p) => p.id).filter((p) => !beforeIds.includes(p));
      const removed = beforeIds.filter((p) => !permissions.some((next) => next.id === p));
      if (added.length) await this.audit(manager, actor.id, PermissionTargetType.ROLE_PERMISSION, id, PermissionChangeType.GRANT, null, { permission_ids: added }, client.ip);
      if (removed.length) await this.audit(manager, actor.id, PermissionTargetType.ROLE_PERMISSION, id, PermissionChangeType.REVOKE, { permission_ids: removed }, null, client.ip);
    });
    return this.role(id);
  }

  async deleteRole(id: string, actor: AuthUser, client: AuditClient) {
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOne(Role, { where: { id } });
      if (!role) throw new NotFoundException('角色不存在');
      if (role.isSystem) throw new ForbiddenException('系統內建角色不可刪除');
      const count = await manager.count(AccountRole, { where: { roleId: id } });
      if (count) throw new ConflictException(`此角色仍綁定 ${count} 個帳號，無法刪除`);
      const permissions = await manager.findBy(RolePermission, { roleId: id });
      await manager.delete(RolePermission, { roleId: id });
      await manager.delete(Role, id);
      await this.audit(manager, actor.id, PermissionTargetType.ROLE, id, PermissionChangeType.DELETE,
        { role_code: role.roleCode, display_name: role.displayName, permission_ids: permissions.map((p) => p.permissionId) }, null, client.ip);
      return { deleted: true, id };
    });
  }

  private async allowedRoles(manager: EntityManager, ids: string[], actor: AuthUser) {
    const roles = await manager.findBy(Role, { id: In(ids) });
    if (roles.length !== ids.length) throw new BadRequestException('包含不存在的角色');
    const rows = ids.length ? await manager.query(
      `SELECT rp.role_id, p.permission_code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ANY($1::uuid[])`, [ids],
    ) : [];
    const mine = new Set(actor.permissions);
    if (rows.some((row: { permission_code: string }) => !mine.has(row.permission_code))) throw new ForbiddenException('不可授予自己沒有的權限');
    return roles;
  }

  private async allowedPermissions(manager: EntityManager, ids: string[], actor: AuthUser) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('權限不可重複');
    const permissions = await manager.findBy(Permission, { id: In(ids) });
    if (permissions.length !== ids.length) throw new BadRequestException('包含不存在的權限');
    const mine = new Set(actor.permissions);
    if (permissions.some((p) => !mine.has(p.permissionCode))) throw new ForbiddenException('不可授予自己沒有的權限');
    return permissions;
  }

  private publicAccount(account: Account, roles: Role[]) {
    return { id: account.id, account_name: account.accountName, display_name: account.displayName, status: account.status,
      roles: roles.map((r) => ({ id: r.id, code: r.roleCode, name: r.displayName })), created_at: account.createdAt, updated_at: account.updatedAt };
  }

  private async isAdmin(manager: EntityManager, accountId: string) {
    const [{ count }] = await manager.query(
      `SELECT COUNT(DISTINCT p.permission_code)::int AS count FROM account_roles ar JOIN role_permissions rp ON rp.role_id=ar.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ar.account_id=$1 AND p.permission_code=ANY($2::text[])`,
      [accountId, ADMIN_PERMISSIONS],
    );
    return Number(count) === ADMIN_PERMISSIONS.length;
  }

  private async adminCount(manager: EntityManager) {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count FROM accounts a WHERE a.deleted_at IS NULL AND a.status='ACTIVE' AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[]) needed(code) WHERE NOT EXISTS (
           SELECT 1 FROM account_roles ar JOIN role_permissions rp ON rp.role_id=ar.role_id JOIN permissions p ON p.id=rp.permission_id
           WHERE ar.account_id=a.id AND p.permission_code=needed.code))`, [ADMIN_PERMISSIONS],
    );
    return Number(count);
  }

  private audit(manager: EntityManager, operatorId: string, targetType: PermissionTargetType, targetId: string,
    changeType: PermissionChangeType, beforeValue: any, afterValue: any, sourceIp?: string) {
    return manager.insert(PermissionChangeLog, { operatorId, targetType, targetId, changeType, beforeValue, afterValue, sourceIp: sourceIp ?? null, createdAt: Date.now() });
  }
}
