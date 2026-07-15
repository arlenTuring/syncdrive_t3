import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimeTemplatePublishStatus } from '../database/entities/time-template.entity';
import { TimeTemplateService } from './time-template.service';

@ApiTags('Time Templates')
@Controller('syncdrive-api/time-template')
export class TimeTemplateController {
  constructor(private readonly timeTemplateService: TimeTemplateService) {}

  @Get('list')
  @ApiOperation({ summary: '時間模板列表（分頁、篩選）' })
  async listTemplates(
    @Query('keyword') keyword?: string,
    @Query('publish_status') publish_status?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    const ps =
      publish_status === TimeTemplatePublishStatus.DRAFT
        || publish_status === TimeTemplatePublishStatus.PUBLISHED
        ? publish_status
        : 'all';

    return this.timeTemplateService.listTemplates({
      keyword,
      publish_status: ps,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }

  @Get('detail/:id')
  @ApiOperation({ summary: '取得時間模板詳情（含 body）' })
  async getTemplateDetail(@Param('id') id: string) {
    return this.timeTemplateService.getTemplateDetail(id);
  }

  @Patch('detail/:id')
  @ApiOperation({ summary: '更新時間模板草稿' })
  async updateDraft(
    @Param('id') id: string,
    @Body() body: { name?: string; body?: Record<string, unknown> },
  ) {
    return this.timeTemplateService.updateDraft(id, {
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Delete('detail/:id')
  @ApiOperation({ summary: '刪除時間模板' })
  async deleteTemplate(@Param('id') id: string) {
    await this.timeTemplateService.deleteTemplate(id);
    return { ok: true };
  }

  @Post('draft')
  @ApiOperation({ summary: '建立時間模板草稿' })
  async createDraft(@Body() body: { name?: string; body?: Record<string, unknown> }) {
    return this.timeTemplateService.createDraft({
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Post('export')
  @ApiOperation({ summary: '匯出時間模板 JSON（依 template_id 列表）' })
  async exportTemplates(@Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return this.timeTemplateService.exportTemplates(ids);
  }
}
