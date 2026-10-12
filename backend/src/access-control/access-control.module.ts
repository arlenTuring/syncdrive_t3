import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../database/entities/account.entity';
import { AccountRole } from '../database/entities/account-role.entity';
import { AccountSession } from '../database/entities/account-session.entity';
import { LoginLog } from '../database/entities/login-log.entity';
import { Permission } from '../database/entities/permission.entity';
import { PermissionChangeLog } from '../database/entities/permission-change-log.entity';
import { RolePermission } from '../database/entities/role-permission.entity';
import { Role } from '../database/entities/role.entity';
import { AccessController } from './access.controller';
import { AccessGuard } from './access.guard';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Role, Permission, RolePermission, AccountRole, AccountSession, LoginLog, PermissionChangeLog])],
  controllers: [AuthController, AccessController],
  providers: [AuthService, AccessService, AccessGuard],
})
export class AccessControlModule {}
