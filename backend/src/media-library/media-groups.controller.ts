import { AuditAction } from '../audit/audit-action.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access-control/access.guard';
import { MediaGroupsService } from './media-groups.service';

/**
 * 媒體分組清單 API。獨立路徑（不掛在 media-library/:id 底下），固定路由不會被 :id 攔截。
 *
 * 權限：檢視 media.groups.view；更名、加入、移除、排序都是 media.groups.edit；建立、刪除各自一個。
 * 不需要媒體內容的建立／編輯／刪除權限；候選清單只回傳加入所需的摘要，不含檔案內容。
 */
@ApiTags('Media Groups')
@Controller('syncdrive-api/media-groups')
@RequirePermission('media.groups.view')
export class MediaGroupsController {
  constructor(private readonly groups: MediaGroupsService) {}

  @Get()
  @ApiOperation({ summary: '分組列表（依分組名稱搜尋、排序、分頁；成員摘要批次帶回）' })
  list(@Query('keyword') keyword?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string, @Query('sort_direction') direction?: string) {
    return this.groups.list({ keyword, page: Number(page), page_size: Number(pageSize), sort_direction: direction });
  }

  @Get('candidates')
  @RequirePermission('media.groups.edit')
  @ApiOperation({ summary: '加入媒體的候選（只有單一媒體；標示已加入與無法加入原因）' })
  candidates(@Query('group_id') groupId: string, @Query('keyword') keyword?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return this.groups.candidates({ group_id: groupId, keyword, page: Number(page), page_size: Number(pageSize) });
  }

  @AuditAction('MEDIA_GROUP_CREATE')
  @Post()
  @RequirePermission('media.groups.create')
  @ApiOperation({ summary: '建立空分組' })
  create(@Body() body: { name?: unknown }) {
    return this.groups.create(body ?? {});
  }

  @Get(':id/delete-impact')
  @RequirePermission('media.groups.delete')
  @ApiOperation({ summary: '刪除前檢查引用（媒體排程、班表、時間模板、整備任務）' })
  deleteImpact(@Param('id') id: string) {
    return this.groups.deleteImpact(id);
  }

  @Get(':id')
  @ApiOperation({ summary: '分組詳情（依序的成員與媒體摘要）' })
  get(@Param('id') id: string) {
    return this.groups.get(id);
  }

  @AuditAction('MEDIA_GROUP_UPDATE')
  @Patch(':id')
  @RequirePermission('media.groups.edit')
  @ApiOperation({ summary: '更名（只改名稱，不動成員）' })
  rename(@Param('id') id: string, @Body() body: { name?: unknown; expected_version?: unknown }) {
    return this.groups.rename(id, body ?? {});
  }

  @AuditAction('MEDIA_GROUP_MEMBERS')
  @Post(':id/members')
  @RequirePermission('media.groups.edit')
  @ApiOperation({ summary: '加入成員（依請求順序附加在最後）' })
  addMembers(@Param('id') id: string, @Body() body: { media_ids?: unknown; expected_version?: unknown }) {
    return this.groups.addMembers(id, body ?? {});
  }

  @AuditAction('MEDIA_GROUP_MEMBERS')
  @Put(':id/members/order')
  @RequirePermission('media.groups.edit')
  @ApiOperation({ summary: '更新成員順序（必須是完整且相同的成員集合）' })
  reorder(@Param('id') id: string, @Body() body: { media_ids?: unknown; expected_version?: unknown }) {
    return this.groups.reorder(id, body ?? {});
  }

  @AuditAction('MEDIA_GROUP_MEMBERS')
  @Delete(':id/members/:mediaId')
  @RequirePermission('media.groups.edit')
  @ApiOperation({ summary: '從此分組移除成員（不刪除媒體）' })
  removeMember(@Param('id') id: string, @Param('mediaId') mediaId: string, @Query('expected_version') expectedVersion?: string) {
    return this.groups.removeMember(id, mediaId, expectedVersion);
  }

  @AuditAction('MEDIA_GROUP_DELETE')
  @Delete(':id')
  @RequirePermission('media.groups.delete')
  @ApiOperation({ summary: '刪除分組（有直接引用時拒絕；不刪媒體）' })
  remove(@Param('id') id: string, @Query('expected_version') expectedVersion?: string) {
    return this.groups.remove(id, expectedVersion);
  }
}
