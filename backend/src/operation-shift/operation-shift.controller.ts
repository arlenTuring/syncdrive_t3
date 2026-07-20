import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';
import { OperationShiftService } from './operation-shift.service';

@ApiTags('Operation Shifts')
@Controller('syncdrive-api/operation-shift')
export class OperationShiftController {
  constructor(private readonly operationShiftService: OperationShiftService) {}

  @Get('list')
  @ApiOperation({ summary: '正線班表列表（分頁、篩選）' })
  async listShifts(
    @Query('keyword') keyword?: string,
    @Query('usage_status') usage_status?: string,
    @Query('publish_status') publish_status?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    const us =
      usage_status === OperationShiftUsageStatus.IDLE
        || usage_status === OperationShiftUsageStatus.IN_USE
        ? usage_status
        : 'all';

    const ps =
      publish_status === OperationShiftPublishStatus.DRAFT
        || publish_status === OperationShiftPublishStatus.PUBLISHED
        ? publish_status
        : 'all';

    return this.operationShiftService.listShifts({
      keyword,
      usage_status: us,
      publish_status: ps,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }

  @Get('check-name')
  @ApiOperation({ summary: '檢查班表名稱是否唯一' })
  async checkName(
    @Query('name') name?: string,
    @Query('exclude_id') exclude_id?: string,
  ) {
    return {
      unique: await this.operationShiftService.isShiftNameUnique(name ?? '', exclude_id),
    };
  }

  @Get('detail/:id')
  @ApiOperation({ summary: '取得班表詳情（含 body）' })
  async getShiftDetail(@Param('id') id: string) {
    return this.operationShiftService.getShiftDetail(id);
  }

  @Post('draft')
  @ApiOperation({ summary: '建立班表草稿' })
  async createDraft(@Body() body: { name?: string; body?: Record<string, unknown> }) {
    return this.operationShiftService.createDraft({
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Post('detail/:id/duplicate')
  @ApiOperation({ summary: '以此複製新版班表草稿' })
  async duplicateDraft(@Param('id') id: string) {
    return this.operationShiftService.duplicateAsNewDraft(id);
  }

  @Post('detail/:id/duplicate-as-manual')
  @ApiOperation({ summary: '參數生成班表複製成手動製作草稿' })
  async duplicateAsManualDraft(@Param('id') id: string) {
    return this.operationShiftService.duplicateAsManualDraft(id);
  }

  @Patch('detail/:id')
  @ApiOperation({ summary: '更新班表草稿' })
  async updateDraft(
    @Param('id') id: string,
    @Body() body: { name?: string; body?: Record<string, unknown> },
  ) {
    return this.operationShiftService.updateDraft(id, {
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Delete('detail/:id')
  @ApiOperation({ summary: '刪除班表' })
  async deleteShift(@Param('id') id: string) {
    await this.operationShiftService.deleteShift(id);
    return { ok: true };
  }
}
