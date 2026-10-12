import { ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Account, AccountStatus } from '../database/entities/account.entity';
import { AccountRole } from '../database/entities/account-role.entity';
import { AccountSession } from '../database/entities/account-session.entity';
import { LoginEventType, LoginLog } from '../database/entities/login-log.entity';
import { Permission } from '../database/entities/permission.entity';
import { PermissionChangeLog, PermissionChangeType, PermissionTargetType } from '../database/entities/permission-change-log.entity';
import { RolePermission } from '../database/entities/role-permission.entity';
import { Role } from '../database/entities/role.entity';
import {
  ACCESS_PERMISSIONS,
  FIXED_ADMIN_ACCOUNT,
  FIXED_ADMIN_DISPLAY_NAME,
  FIXED_ADMIN_PASSWORD,
  SESSION_TTL_MS,
} from './access.constants';
import { hashPassword, verifyPassword } from './password';

export type AuthUser = {
  id: string;
  account_name: string;
  display_name: string;
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
};

type Client = { ip?: string; userAgent?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(AccountSession) private readonly sessions: Repository<AccountSession>,
    @InjectRepository(LoginLog) private readonly loginLogs: Repository<LoginLog>,
  ) {}

  async onModuleInit() {
    for (const item of ACCESS_PERMISSIONS) {
      await this.permissions.upsert(
        { permissionCode: item.code, module: item.module, displayName: item.name, description: null },
        ['permissionCode'],
      );
    }
    await this.ensureFixedAdministrator();
    await this.dataSource.query('DELETE FROM account_sessions WHERE expires_at <= $1', [Date.now()]);
  }

  private async ensureFixedAdministrator() {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('access-control-fixed-administrator'))`);
      const now = Date.now();
      let role = await manager.findOne(Role, { where: { roleCode: 'SUPER_ADMIN' } });
      if (!role) {
        role = await manager.save(Role, manager.create(Role, {
          roleCode: 'SUPER_ADMIN', displayName: '最高管理員', description: '系統內建最高管理角色',
          isSystem: true, createdAt: now, updatedAt: now,
        }));
      }

      const permissionRows = await manager.findBy(Permission, {
        permissionCode: In(ACCESS_PERMISSIONS.map((permission) => permission.code)),
      });
      const rolePermissionRepo = manager.getRepository(RolePermission);
      for (const permission of permissionRows) {
        if (!await rolePermissionRepo.existsBy({ roleId: role.id, permissionId: permission.id })) {
          await rolePermissionRepo.insert({ roleId: role.id, permissionId: permission.id, createdAt: now });
        }
      }

      const accountRepo = manager.getRepository(Account);
      let account = await accountRepo.findOne({ where: { accountName: FIXED_ADMIN_ACCOUNT } });
      const passwordMatches = account?.passwordHash
        ? await verifyPassword(FIXED_ADMIN_PASSWORD, account.passwordHash)
        : false;
      const created = !account;
      const repaired = !!account && (
        !passwordMatches || account.status !== AccountStatus.ACTIVE || account.deletedAt !== null ||
        account.failedLoginCount !== 0 || account.lockedUntil !== null
      );
      if (!account) {
        account = accountRepo.create({
          accountName: FIXED_ADMIN_ACCOUNT, displayName: FIXED_ADMIN_DISPLAY_NAME,
          passwordHash: await hashPassword(FIXED_ADMIN_PASSWORD), status: AccountStatus.ACTIVE,
          failedLoginCount: 0, lockedUntil: null, deletedAt: null, createdAt: now, updatedAt: now,
        });
      } else if (repaired) {
        account.passwordHash = passwordMatches ? account.passwordHash : await hashPassword(FIXED_ADMIN_PASSWORD);
        account.status = AccountStatus.ACTIVE;
        account.deletedAt = null;
        account.failedLoginCount = 0;
        account.lockedUntil = null;
        account.updatedAt = now;
      }
      if (created || repaired) account = await accountRepo.save(account);

      const accountRoleRepo = manager.getRepository(AccountRole);
      if (!await accountRoleRepo.existsBy({ accountId: account.id, roleId: role.id })) {
        await accountRoleRepo.insert({ accountId: account.id, roleId: role.id, assignedBy: account.id, createdAt: now });
      }
      if (created || repaired) {
        await manager.save(PermissionChangeLog, manager.create(PermissionChangeLog, {
          operatorId: account.id, targetType: PermissionTargetType.ACCOUNT, targetId: account.id,
          changeType: created ? PermissionChangeType.CREATE : PermissionChangeType.UPDATE,
          beforeValue: null, afterValue: {
            account_name: account.accountName, display_name: account.displayName,
            role_ids: [role.id], fixed_administrator_restored: repaired,
          },
          sourceIp: null, createdAt: now,
        }));
      }
    });
  }

  async login(accountName: string, password: string, client: Client) {
    const account = await this.accounts.createQueryBuilder('a')
      .where('LOWER(a.account_name) = LOWER(:name)', { name: accountName.trim() })
      .andWhere('a.deleted_at IS NULL').getOne();
    const now = Date.now();
    const failure = async (reason: string) => {
      await this.loginLogs.save(this.loginLogs.create({ accountId: account?.id ?? null, accountName: accountName.trim(), eventType: LoginEventType.LOGIN_FAILED, sourceIp: client.ip ?? null, userAgent: client.userAgent ?? null, failureReason: reason, createdAt: now }));
      throw new UnauthorizedException('帳號或密碼錯誤');
    };
    if (!account || account.status !== AccountStatus.ACTIVE || (account.lockedUntil ?? 0) > now) return failure('帳號不存在、停用或暫時鎖定');
    if (!(await verifyPassword(password, account.passwordHash))) {
      const failures = account.failedLoginCount + 1;
      await this.accounts.update(account.id, { failedLoginCount: failures, lockedUntil: failures >= 5 ? now + 15 * 60_000 : null, updatedAt: now });
      return failure('密碼錯誤');
    }
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Account, account.id, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now });
      await manager.save(AccountSession, manager.create(AccountSession, { accountId: account.id, tokenHash: digest(token), csrfHash: digest(csrf), sourceIp: client.ip ?? null, userAgent: client.userAgent ?? null, expiresAt: now + SESSION_TTL_MS, createdAt: now }));
      await manager.insert(LoginLog, { accountId: account.id, accountName: account.accountName, eventType: LoginEventType.LOGIN, sourceIp: client.ip ?? null, userAgent: client.userAgent ?? null, failureReason: null, createdAt: now });
    });
    return { token, csrf, user: await this.userById(account.id) };
  }

  async logout(token: string | null, client: Client) {
    if (!token) return;
    const session = await this.sessions.findOne({ where: { tokenHash: digest(token) } });
    if (!session) return;
    const account = await this.accounts.findOne({ where: { id: session.accountId } });
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AccountSession, session.id);
      if (account) await manager.insert(LoginLog, { accountId: account.id, accountName: account.accountName, eventType: LoginEventType.LOGOUT, sourceIp: client.ip ?? null, userAgent: client.userAgent ?? null, failureReason: null, createdAt: Date.now() });
    });
  }

  async authenticate(token: string | null, csrf?: string, requireCsrf = false) {
    if (!token) return null;
    const session = await this.sessions.findOne({ where: { tokenHash: digest(token) } });
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await this.sessions.delete(session.id);
      return null;
    }
    if (requireCsrf && (!csrf || !this.safeEqual(digest(csrf), session.csrfHash))) throw new ForbiddenException('CSRF 驗證失敗');
    return { user: await this.userById(session.accountId), csrf: session.csrfHash };
  }

  async me(token: string | null) {
    if (!token) return null;
    const session = await this.sessions.findOne({ where: { tokenHash: digest(token) } });
    if (!session || session.expiresAt <= Date.now()) return null;
    const csrf = randomBytes(24).toString('base64url');
    await this.sessions.update(session.id, { csrfHash: digest(csrf) });
    return { user: await this.userById(session.accountId), csrf };
  }

  async userById(id: string): Promise<AuthUser> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account || account.deletedAt || account.status !== AccountStatus.ACTIVE) throw new UnauthorizedException('帳號已停用');
    const rows = await this.dataSource.query(
      `SELECT r.id, r.role_code, r.display_name, p.permission_code
       FROM account_roles ar JOIN roles r ON r.id = ar.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE ar.account_id = $1 ORDER BY r.display_name, p.permission_code`, [id],
    );
    const roles = new Map<string, { id: string; code: string; name: string }>();
    const permissions = new Set<string>();
    for (const row of rows) {
      roles.set(row.id, { id: row.id, code: row.role_code, name: row.display_name });
      if (row.permission_code) permissions.add(row.permission_code);
    }
    return { id: account.id, account_name: account.accountName, display_name: account.displayName, roles: [...roles.values()], permissions: [...permissions] };
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left); const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
