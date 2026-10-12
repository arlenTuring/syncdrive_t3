import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { AccessService } from './access.service';
import { AccountQueryDto, CreateAccountDto, ResetPasswordDto, RoleQueryDto, SaveRoleDto, UpdateAccountRolesDto } from './access.dto';
import { type AuthenticatedRequest, RequirePermission } from './access.guard';

@Controller('syncdrive-api/access-control')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('accounts') @RequirePermission('access.accounts.view')
  accounts(@Query() query: AccountQueryDto) { return this.access.listAccounts(query); }

  @Post('accounts') @RequirePermission('access.accounts.manage')
  createAccount(@Body() body: CreateAccountDto, @Req() req: AuthenticatedRequest) {
    return this.access.createAccount(body, req.authUser!, this.client(req));
  }

  @Post('accounts/:id/reset-password') @RequirePermission('access.accounts.manage')
  resetPassword(@Param('id') id: string, @Body() body: ResetPasswordDto, @Req() req: AuthenticatedRequest) {
    return this.access.resetPassword(id, body.password, req.authUser!, this.client(req));
  }

  @Delete('accounts/:id') @RequirePermission('access.accounts.manage')
  deleteAccount(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.access.deleteAccount(id, req.authUser!, this.client(req));
  }

  @Patch('accounts/:id/roles') @RequirePermission('access.accounts.manage')
  updateAccountRoles(@Param('id') id: string, @Body() body: UpdateAccountRolesDto, @Req() req: AuthenticatedRequest) {
    return this.access.updateAccountRoles(id, body.role_ids, req.authUser!, this.client(req));
  }

  @Get('roles/options') @RequirePermission('access.accounts.manage')
  roleOptions(@Req() req: AuthenticatedRequest) { return this.access.roleOptions(req.authUser!); }

  @Get('roles') @RequirePermission('access.roles.view')
  roles(@Query() query: RoleQueryDto) { return this.access.listRoles(query); }

  @Get('roles/:id') @RequirePermission('access.roles.view')
  role(@Param('id') id: string) { return this.access.role(id); }

  @Post('roles') @RequirePermission('access.roles.manage')
  createRole(@Body() body: SaveRoleDto, @Req() req: AuthenticatedRequest) {
    return this.access.createRole(body, req.authUser!, this.client(req));
  }

  @Patch('roles/:id') @RequirePermission('access.roles.manage')
  updateRole(@Param('id') id: string, @Body() body: SaveRoleDto, @Req() req: AuthenticatedRequest) {
    return this.access.updateRole(id, body, req.authUser!, this.client(req));
  }

  @Delete('roles/:id') @RequirePermission('access.roles.manage')
  deleteRole(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.access.deleteRole(id, req.authUser!, this.client(req));
  }

  @Get('permissions') @RequirePermission('access.roles.view')
  permissions() { return this.access.permissionDictionary(); }

  @Get('permissions/catalog') @RequirePermission('access.roles.view')
  permissionCatalog(@Req() req: AuthenticatedRequest) { return this.access.permissionCatalog(req.authUser!); }

  private client(req: Request) { return { ip: req.ip }; }
}
