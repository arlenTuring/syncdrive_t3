import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdjustExecutionDto,
  CreateDegradedOperationPlanDto,
  ExecutionVersionDto,
  ExecuteDegradedOperationDto,
  InteractionEventDto,
  RestoreExecutionDto,
  SaveDraftDto,
  UpdateDegradedOperationPlanDto,
  UpdateExecutionContentDto,
} from './degraded-operation.dto';
import { DegradedOperationService } from './degraded-operation.service';

@ApiTags('Degraded Operation')
@Controller('syncdrive-api/degraded-operation')
export class DegradedOperationController {
  constructor(private readonly service: DegradedOperationService) {}

  @Get('status')
  @ApiOperation({ summary: '取得目前場域營運模式' })
  status() {
    return this.service.getOperationStatus();
  }

  @Get('plans')
  @ApiOperation({ summary: '取得降級計畫清單與總數' })
  list(
    @Query('sort_by') sortBy?: string,
    @Query('sort_direction') direction?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.service.list({
      sortBy,
      direction,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get('plans/:id')
  @ApiOperation({ summary: '取得單一降級計畫' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('plans')
  @ApiOperation({ summary: '建立降級計畫（不啟用、不下發速限）' })
  create(
    @Body() body: CreateDegradedOperationPlanDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation('plan_create_failed', operator, {}, () =>
      this.service.create(body, operator),
    );
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: '更新降級計畫（不啟用、不下發速限）' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateDegradedOperationPlanDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation('plan_update_failed', operator, { planId: id }, () =>
      this.service.update(id, body, operator),
    );
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: '刪除降級計畫（不解除執行狀態、不刪除歷史快照）' })
  remove(
    @Param('id') id: string,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation('plan_delete_failed', operator, { planId: id }, () =>
      this.service.remove(id, operator),
    );
  }

  @Post('executions')
  @ApiOperation({ summary: '建立降級執行快照；控制流程未接通時不下發指令' })
  execute(
    @Body() body: ExecuteDegradedOperationDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation(
      'execution_submit_failed',
      operator,
      { planId: body.source_plan_id },
      () => this.service.execute(body, operator),
    );
  }

  @Post('executions/:id/cancel')
  @ApiOperation({ summary: '取消待執行的降級預約' })
  cancel(
    @Param('id') id: string,
    @Body() body: ExecutionVersionDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation(
      'schedule_cancel_failed',
      operator,
      { executionId: id },
      () => this.service.cancelScheduled(id, body.version, operator),
    );
  }

  @Patch('executions/:id/parameters')
  @ApiOperation({ summary: '調整目前降級執行參數（不修改來源範本）' })
  adjust(
    @Param('id') id: string,
    @Body() body: AdjustExecutionDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation(
      'parameters_adjust_failed',
      operator,
      { executionId: id },
      () => this.service.adjust(id, body, operator),
    );
  }

  @Patch('executions/:id/content')
  @ApiOperation({ summary: '更新本次降級內容（不修改來源範本）' })
  content(
    @Param('id') id: string,
    @Body() body: UpdateExecutionContentDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation(
      'content_update_failed',
      operator,
      { executionId: id },
      () => this.service.updateContent(id, body, operator),
    );
  }

  @Post('executions/:id/restore')
  @ApiOperation({ summary: '完成安全確認並解除本次降級管理狀態' })
  restore(
    @Param('id') id: string,
    @Body() body: RestoreExecutionDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.mutation('restore_failed', operator, { executionId: id }, () =>
      this.service.restore(id, body, operator),
    );
  }

  @Get('drafts/:kind')
  @ApiOperation({ summary: '取得目前操作者的降級表單草稿' })
  draft(
    @Param('kind') kind: string,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.getDraft(kind, operator);
  }

  @Post('drafts/:kind')
  @ApiOperation({ summary: '保存目前操作者的降級表單草稿' })
  saveDraft(
    @Param('kind') kind: string,
    @Body() body: SaveDraftDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.saveDraft(kind, body, operator);
  }

  @Post('events')
  @ApiOperation({ summary: '記錄降級操作介面事件' })
  event(
    @Body() body: InteractionEventDto,
    @Headers('x-syncdrive-operator') operator?: string,
  ) {
    return this.service.recordInteraction(body, operator);
  }

  @Get('events')
  @ApiOperation({ summary: '查詢降級操作紀錄' })
  events(@Query('execution_id') executionId?: string) {
    return this.service.listEvents(executionId);
  }

  private async mutation<T>(
    failureAction: string,
    operator: string | undefined,
    links: { planId?: string; executionId?: string },
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      await this.service.recordFailure(failureAction, operator, links, error);
      throw error;
    }
  }
}
