import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MaintenanceTaskPublishStatus,
  MaintenanceTaskUsageStatus,
} from '../database/entities/maintenance-task.entity';
import { MaintenanceTaskService } from './maintenance-task.service';

@ApiTags('Maintenance Tasks')
@Controller('syncdrive-api/maintenance-task')
export class MaintenanceTaskController {
  constructor(private readonly maintenanceTaskService: MaintenanceTaskService) {}

  @Get('list')
  @ApiOperation({ summary: '整備任務列表（分頁、篩選）' })
  async listTasks(
    @Query('keyword') keyword?: string,
    @Query('usage_status') usage_status?: string,
    @Query('publish_status') publish_status?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    const us =
      usage_status === MaintenanceTaskUsageStatus.IDLE
        || usage_status === MaintenanceTaskUsageStatus.IN_USE
        ? usage_status
        : 'all';

    const ps =
      publish_status === MaintenanceTaskPublishStatus.DRAFT
        || publish_status === MaintenanceTaskPublishStatus.PUBLISHED
        ? publish_status
        : 'all';

    return this.maintenanceTaskService.listTasks({
      keyword,
      usage_status: us,
      publish_status: ps,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }

  @Get('check-name')
  @ApiOperation({ summary: '檢查整備任務名稱是否唯一' })
  async checkName(
    @Query('name') name?: string,
    @Query('exclude_id') exclude_id?: string,
  ) {
    return {
      unique: await this.maintenanceTaskService.isTaskNameUnique(name ?? '', exclude_id),
    };
  }

  @Get('detail/:id')
  @ApiOperation({ summary: '取得整備任務詳情（含 body）' })
  async getTaskDetail(@Param('id') id: string) {
    return this.maintenanceTaskService.getTaskDetail(id);
  }

  @Post('draft')
  @ApiOperation({ summary: '建立整備任務草稿' })
  async createDraft(@Body() body: { name?: string; body?: Record<string, unknown> }) {
    return this.maintenanceTaskService.createDraft({
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Patch('detail/:id')
  @ApiOperation({ summary: '更新整備任務草稿' })
  async updateDraft(
    @Param('id') id: string,
    @Body() body: { name?: string; body?: Record<string, unknown> },
  ) {
    return this.maintenanceTaskService.updateDraft(id, {
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Delete('detail/:id')
  @ApiOperation({ summary: '刪除整備任務' })
  async deleteTask(@Param('id') id: string) {
    await this.maintenanceTaskService.deleteTask(id);
    return { ok: true };
  }
}
