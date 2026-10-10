import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DegradedOperationDraft } from '../database/entities/degraded-operation-draft.entity';
import { DegradedOperationEvent } from '../database/entities/degraded-operation-event.entity';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import { DegradedOperationPlan } from '../database/entities/degraded-operation-plan.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import type {
  AdjustExecutionDto,
  CreateDegradedOperationPlanDto,
  ExecuteDegradedOperationDto,
  InteractionEventDto,
  RestoreExecutionDto,
  SaveDraftDto,
  UpdateDegradedOperationPlanDto,
  UpdateExecutionContentDto,
} from './degraded-operation.dto';

const STATE_KEY = 'degraded_operation.state';
const BUSY_STATUSES = ['scheduled', 'activating', 'active', 'restoring'];
const CONTROL_UNAVAILABLE = 'degraded_control_contract_unavailable';

type StateValue = {
  mode: 'normal' | 'degraded';
  pendingExecutionId?: string;
  activeExecutionId?: string;
};

export function resolveScheduledOperatingTime(
  operatingNow: number,
  hhmm: string,
  timeZone: string,
): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    throw new BadRequestException('執行時間格式必須為 HH:mm');
  }
  const parts = zonedParts(operatingNow, timeZone);
  const [hour, minute] = hhmm.split(':').map(Number);
  const wanted = zonedEpoch(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
    timeZone,
  );
  const currentMinute = Math.floor(operatingNow / 60_000) * 60_000;
  if (wanted < currentMinute)
    throw new BadRequestException('執行時間已經過去，請重新選擇');
  return wanted <= operatingNow ? operatingNow : wanted;
}

@Injectable()
export class DegradedOperationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(DegradedOperationPlan)
    private readonly plans: Repository<DegradedOperationPlan>,
    @InjectRepository(DegradedOperationExecution)
    private readonly executions: Repository<DegradedOperationExecution>,
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
    @InjectRepository(DegradedOperationEvent)
    private readonly events: Repository<DegradedOperationEvent>,
    @InjectRepository(DegradedOperationDraft)
    private readonly drafts: Repository<DegradedOperationDraft>,
    private readonly dataSource: DataSource,
    private readonly clock: OperatingClockService,
    private readonly foundation: SystemFoundationSettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processDueSchedules(), 1_000);
    this.timer.unref();
    void this.processDueSchedules();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(
    input: {
      sortBy?: string;
      direction?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20));
    const orderField =
      ({ name: 'name', level: 'level', speed: 'speedLimitKmh' } as const)[
        input.sortBy as 'name' | 'level' | 'speed'
      ] ?? 'updatedAt';
    const [items, total] = await this.plans.findAndCount({
      order: {
        [orderField]: input.direction === 'asc' ? 'ASC' : 'DESC',
        id: 'ASC',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((item) => this.planResponse(item)),
      total,
      page,
      page_size: pageSize,
    };
  }

  async get(id: string) {
    return this.planResponse(await this.requirePlan(id));
  }

  async create(input: CreateDegradedOperationPlanDto, operator = 'unknown') {
    return this.dataSource.transaction(async (manager) => {
      const now = String(Date.now());
      const plan = manager.create(DegradedOperationPlan, {
        id: randomUUID(),
        name: this.requireName(input.name),
        description: this.description(input.description),
        level: input.level,
        speedLimitKmh: input.speed_limit_kmh,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await manager.save(plan);
      await this.addEvent(manager, {
        action: 'plan_created',
        operator,
        planId: plan.id,
        after: this.planResponse(plan),
      });
      return this.planResponse(plan);
    });
  }

  async update(
    id: string,
    input: UpdateDegradedOperationPlanDto,
    operator = 'unknown',
  ) {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager.findOne(DegradedOperationPlan, {
        where: { id },
      });
      if (!plan) throw new NotFoundException(`降級計畫 '${id}' 不存在`);
      if (input.version !== undefined && plan.version !== input.version)
        throw new ConflictException('計畫已被其他使用者更新，請重新載入');
      const before = this.planResponse(plan);
      if (input.name !== undefined) plan.name = this.requireName(input.name);
      if (input.description !== undefined)
        plan.description = this.description(input.description);
      if (input.level !== undefined) plan.level = input.level;
      if (input.speed_limit_kmh !== undefined)
        plan.speedLimitKmh = input.speed_limit_kmh;
      plan.version += 1;
      plan.updatedAt = String(Date.now());
      await manager.save(plan);
      await this.addEvent(manager, {
        action: 'plan_updated',
        operator,
        planId: id,
        before,
        after: this.planResponse(plan),
      });
      return this.planResponse(plan);
    });
  }

  async remove(id: string, operator = 'unknown') {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager.findOne(DegradedOperationPlan, {
        where: { id },
      });
      if (!plan) throw new NotFoundException(`降級計畫 '${id}' 不存在`);
      await manager.delete(DegradedOperationPlan, id);
      await this.addEvent(manager, {
        action: 'plan_deleted',
        operator,
        planId: id,
        before: this.planResponse(plan),
      });
      return { deleted: true, id };
    });
  }

  async execute(input: ExecuteDegradedOperationDto, operator = 'unknown') {
    if (input.source_plan_id) await this.requirePlan(input.source_plan_id);

    const operatingNow = this.clock.now();
    const realNow = Date.now();
    const zone = input.time_zone || 'Asia/Taipei';
    const scheduledFor =
      input.schedule_mode === 'scheduled'
        ? resolveScheduledOperatingTime(
            operatingNow,
            input.scheduled_time || '',
            zone,
          )
        : operatingNow;
    const immediate = scheduledFor <= operatingNow;
    const defaultSpeed = (await this.foundation.get()).globalParams
      .defaultVehicleSpeedLimitKmh;

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'degraded_operation_execute',
      ]);
      const duplicate = await manager.findOne(DegradedOperationExecution, {
        where: { idempotencyKey: input.idempotency_key },
      });
      if (duplicate)
        return this.executionResponse(
          duplicate,
          '相同請求已受理，未重複建立執行。',
        );
      const busy = await manager.findOne(DegradedOperationExecution, {
        where: { executionStatus: In(BUSY_STATUSES) },
      });
      if (busy) throw new ConflictException('目前已有待執行或進行中的降級操作');
      const execution = manager.create(DegradedOperationExecution, {
        id: randomUUID(),
        sourcePlanId: input.source_plan_id ?? null,
        planName: this.requireName(input.name),
        planDescription: this.description(input.description),
        level: input.level,
        speedLimitKmh: input.speed_limit_kmh,
        operatorId: this.operator(operator),
        controlStatus: 'not_dispatched',
        executionStatus: immediate ? 'active' : 'scheduled',
        scheduleMode: immediate ? 'immediate' : 'scheduled',
        scheduledForOperating: immediate ? null : String(scheduledFor),
        scheduledTimezone: zone,
        startedAtOperating: immediate ? String(operatingNow) : null,
        startedAtReal: immediate ? String(realNow) : null,
        endedAtOperating: null,
        endedAtReal: null,
        restoreSpeedLimitKmh: defaultSpeed,
        restoreChecks: null,
        errorReason: null,
        idempotencyKey: input.idempotency_key,
        version: 1,
        commandTracking: [
          {
            at: realNow,
            result: 'not_dispatched',
            reason: CONTROL_UNAVAILABLE,
          },
        ],
        createdAt: String(realNow),
        updatedAt: String(realNow),
      });
      await manager.save(execution);
      await this.writeState(
        manager,
        immediate
          ? { mode: 'degraded', activeExecutionId: execution.id }
          : { mode: 'normal', pendingExecutionId: execution.id },
      );
      await this.addEvent(manager, {
        action: immediate ? 'immediate_submitted' : 'schedule_submitted',
        operator,
        executionId: execution.id,
        planId: execution.sourcePlanId,
        after: this.executionResponse(execution),
        operatingAt: operatingNow,
      });
      await this.addEvent(manager, {
        action: 'control_not_dispatched',
        operator,
        executionId: execution.id,
        after: { reason: CONTROL_UNAVAILABLE },
        result: 'rejected',
        operatingAt: operatingNow,
      });
      return this.executionResponse(
        execution,
        immediate
          ? '管理端已進入降級狀態；車端控制契約尚未接通，未下發任何指令。'
          : '降級預約已保存，將由後端營運時鐘啟用。',
      );
    });
  }

  async cancelScheduled(id: string, version: number, operator = 'unknown') {
    return this.dataSource.transaction(async (manager) => {
      const execution = await this.lockExecution(
        manager,
        id,
        version,
        'scheduled',
      );
      const before = this.executionResponse(execution);
      execution.executionStatus = 'cancelled';
      execution.version += 1;
      execution.updatedAt = String(Date.now());
      await manager.save(execution);
      await this.writeState(manager, { mode: 'normal' });
      await this.addEvent(manager, {
        action: 'schedule_cancelled',
        operator,
        executionId: id,
        before,
        after: this.executionResponse(execution),
      });
      return this.executionResponse(execution, '預約已取消。');
    });
  }

  async adjust(id: string, input: AdjustExecutionDto, operator = 'unknown') {
    return this.dataSource.transaction(async (manager) => {
      const execution = await this.lockExecution(
        manager,
        id,
        input.version,
        'active',
      );
      const before = this.executionResponse(execution);
      execution.level = input.level;
      execution.speedLimitKmh = input.speed_limit_kmh;
      execution.controlStatus = 'not_dispatched';
      execution.commandTracking = [
        ...execution.commandTracking,
        {
          at: Date.now(),
          result: 'not_dispatched',
          reason: CONTROL_UNAVAILABLE,
        },
      ];
      execution.version += 1;
      execution.updatedAt = String(Date.now());
      await manager.save(execution);
      await this.addEvent(manager, {
        action: 'parameters_adjusted',
        operator,
        executionId: id,
        before,
        after: this.executionResponse(execution),
      });
      await this.addEvent(manager, {
        action: 'control_not_dispatched',
        operator,
        executionId: id,
        result: 'rejected',
        after: { reason: CONTROL_UNAVAILABLE },
      });
      return this.executionResponse(
        execution,
        '參數已保存；車端控制尚未下發。',
      );
    });
  }

  async updateContent(
    id: string,
    input: UpdateExecutionContentDto,
    operator = 'unknown',
  ) {
    return this.dataSource.transaction(async (manager) => {
      const execution = await this.lockExecution(
        manager,
        id,
        input.version,
        'active',
      );
      const before = this.executionResponse(execution);
      execution.planName = this.requireName(input.name);
      execution.planDescription = this.description(input.description);
      execution.level = input.level;
      execution.version += 1;
      execution.updatedAt = String(Date.now());
      await manager.save(execution);
      await this.addEvent(manager, {
        action: 'content_updated',
        operator,
        executionId: id,
        before,
        after: this.executionResponse(execution),
      });
      return this.executionResponse(execution, '本次降級內容已更新。');
    });
  }

  async restore(id: string, input: RestoreExecutionDto, operator = 'unknown') {
    if (!input.personnel_and_vehicles_cleared || !input.alarms_cleared) {
      throw new BadRequestException('解除降級前必須完成兩項安全確認');
    }
    return this.dataSource.transaction(async (manager) => {
      const execution = await this.lockExecution(
        manager,
        id,
        input.version,
        'active',
      );
      if (execution.controlStatus === 'applied') {
        throw new ConflictException(
          '車端恢復控制契約尚未接通，為避免假恢復，降級狀態保持不變',
        );
      }
      const before = this.executionResponse(execution);
      execution.executionStatus = 'ended';
      execution.restoreChecks = {
        personnel_and_vehicles_cleared: true,
        alarms_cleared: true,
      };
      execution.endedAtOperating = String(this.clock.now());
      execution.endedAtReal = String(Date.now());
      execution.version += 1;
      execution.updatedAt = String(Date.now());
      await manager.save(execution);
      await this.writeState(manager, { mode: 'normal' });
      await this.addEvent(manager, {
        action: 'degraded_restored',
        operator,
        executionId: id,
        before,
        after: this.executionResponse(execution),
        operatingAt: Number(execution.endedAtOperating),
      });
      return this.executionResponse(
        execution,
        '管理端降級狀態已解除；本次未曾下發車端限制，未清除其他速限。',
      );
    });
  }

  async getOperationStatus() {
    const row = await this.ensureState();
    const state = this.stateValue(row.settingValue);
    const id = state.activeExecutionId || state.pendingExecutionId;
    const execution = id
      ? await this.executions.findOne({ where: { id } })
      : null;
    const consistent =
      state.mode === 'degraded'
        ? execution?.executionStatus === 'active'
        : !state.pendingExecutionId ||
          execution?.executionStatus === 'scheduled';
    return {
      mode: consistent ? state.mode : 'unknown',
      pending:
        execution?.executionStatus === 'scheduled'
          ? this.executionResponse(execution)
          : null,
      active_execution:
        execution?.executionStatus === 'active'
          ? this.executionResponse(execution)
          : null,
      operating_now: this.clock.now(),
      real_now: Date.now(),
      updated_at: row.updatedAt,
      source: 'system_settings',
    };
  }

  async saveDraft(kind: string, input: SaveDraftDto, operator = 'unknown') {
    const key = `${this.operator(operator)}:${kind}`.slice(0, 220);
    const now = String(Date.now());
    let draft = await this.drafts.findOne({ where: { key } });
    if (draft && input.version !== undefined && draft.version !== input.version)
      throw new ConflictException('草稿已在其他視窗更新');
    draft =
      draft ??
      this.drafts.create({
        key,
        operatorId: this.operator(operator),
        kind,
        value: {},
        status: 'open',
        version: 0,
        updatedAt: now,
      });
    draft.value = input.value;
    draft.status = input.status || 'open';
    draft.version += 1;
    draft.updatedAt = now;
    await this.drafts.save(draft);
    return this.draftResponse(draft);
  }

  async getDraft(kind: string, operator = 'unknown') {
    const key = `${this.operator(operator)}:${kind}`.slice(0, 220);
    const draft = await this.drafts.findOne({ where: { key } });
    return draft ? this.draftResponse(draft) : null;
  }

  async recordInteraction(input: InteractionEventDto, operator = 'unknown') {
    const event = await this.events.save(
      this.events.create({
        id: randomUUID(),
        executionId: input.execution_id ?? null,
        draftKey: input.draft_key ?? null,
        planId: input.plan_id ?? null,
        action: input.action,
        operatorId: this.operator(operator),
        realAt: String(Date.now()),
        operatingAt: String(this.clock.now()),
        beforeValue: null,
        afterValue: input.detail ?? null,
        result: 'success',
        errorReason: null,
      }),
    );
    return { event_id: event.id };
  }

  async recordFailure(
    action: string,
    operator = 'unknown',
    links: { planId?: string; executionId?: string } = {},
    error?: unknown,
  ) {
    try {
      await this.events.save(
        this.events.create({
          id: randomUUID(),
          executionId: links.executionId ?? null,
          draftKey: null,
          planId: links.planId ?? null,
          action,
          operatorId: this.operator(operator),
          realAt: String(Date.now()),
          operatingAt: String(this.clock.now()),
          beforeValue: null,
          afterValue: null,
          result: 'failed',
          errorReason: error instanceof Error ? error.message : String(error),
        }),
      );
    } catch {
      // Failure audit must not replace the original business error.
    }
  }

  async listEvents(executionId?: string) {
    const items = await this.events.find({
      where: executionId ? { executionId } : {},
      order: { realAt: 'DESC' },
      take: 200,
    });
    return { items };
  }

  async processDueSchedules(): Promise<void> {
    const operatingNow = this.clock.now();
    const due = await this.executions
      .createQueryBuilder('execution')
      .where('execution.execution_status = :status', { status: 'scheduled' })
      .andWhere('execution.scheduled_for_operating <= :now', {
        now: String(operatingNow),
      })
      .orderBy('execution.scheduled_for_operating', 'ASC')
      .getOne();
    if (!due) return;
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'degraded_operation_execute',
      ]);
      const execution = await manager.findOne(DegradedOperationExecution, {
        where: { id: due.id },
      });
      if (!execution || execution.executionStatus !== 'scheduled') return;
      const realNow = Date.now();
      execution.executionStatus = 'active';
      execution.startedAtOperating = String(operatingNow);
      execution.startedAtReal = String(realNow);
      execution.version += 1;
      execution.updatedAt = String(realNow);
      execution.commandTracking = [
        ...execution.commandTracking,
        {
          at: realNow,
          result: 'not_dispatched',
          reason: CONTROL_UNAVAILABLE,
          schedule_delay_ms: Math.max(
            0,
            operatingNow - Number(execution.scheduledForOperating),
          ),
        },
      ];
      await manager.save(execution);
      await this.writeState(manager, {
        mode: 'degraded',
        activeExecutionId: execution.id,
      });
      await this.addEvent(manager, {
        action: 'schedule_due',
        operator: 'system',
        executionId: execution.id,
        before: { execution_status: 'scheduled' },
        after: this.executionResponse(execution),
        operatingAt: operatingNow,
      });
    });
  }

  private async lockExecution(
    manager: EntityManager,
    id: string,
    version: number,
    status: string,
  ) {
    const execution = await manager.findOne(DegradedOperationExecution, {
      where: { id },
    });
    if (!execution) throw new NotFoundException(`降級執行 '${id}' 不存在`);
    if (execution.version !== version)
      throw new ConflictException('執行資料已被其他使用者更新，請重新載入');
    if (execution.executionStatus !== status)
      throw new ConflictException(
        `目前狀態不可執行此操作：${execution.executionStatus}`,
      );
    return execution;
  }

  private async requirePlan(id: string) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`降級計畫 '${id}' 不存在`);
    return plan;
  }

  private async ensureState() {
    let row = await this.settings.findOne({ where: { settingKey: STATE_KEY } });
    if (!row)
      row = await this.settings.save(
        this.settings.create({
          settingKey: STATE_KEY,
          settingValue: { mode: 'normal' },
          valueType: 'json',
          description: '場域降級運轉狀態；只由正式執行流程更新',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    return row;
  }

  private async writeState(manager: EntityManager, value: StateValue) {
    let row = await manager.findOne(SystemSetting, {
      where: { settingKey: STATE_KEY },
    });
    const now = Date.now();
    if (!row)
      row = manager.create(SystemSetting, {
        settingKey: STATE_KEY,
        settingValue: value,
        valueType: 'json',
        description: '場域降級運轉狀態；只由正式執行流程更新',
        createdAt: now,
        updatedAt: now,
      });
    row.settingValue = value;
    row.updatedAt = now;
    await manager.save(row);
  }

  private stateValue(value: unknown): StateValue {
    if (!value || typeof value !== 'object') return { mode: 'normal' };
    const state = value as Partial<StateValue>;
    return state.mode === 'degraded'
      ? { ...state, mode: 'degraded' }
      : { ...state, mode: 'normal' };
  }

  private async addEvent(
    manager: EntityManager,
    input: {
      action: string;
      operator: string;
      executionId?: string | null;
      planId?: string | null;
      before?: unknown;
      after?: unknown;
      result?: string;
      error?: string;
      operatingAt?: number;
    },
  ) {
    await manager.save(
      manager.create(DegradedOperationEvent, {
        id: randomUUID(),
        executionId: input.executionId ?? null,
        draftKey: null,
        planId: input.planId ?? null,
        action: input.action,
        operatorId: this.operator(input.operator),
        realAt: String(Date.now()),
        operatingAt: String(input.operatingAt ?? this.clock.now()),
        beforeValue: input.before ?? null,
        afterValue: input.after ?? null,
        result: input.result ?? 'success',
        errorReason: input.error ?? null,
      }),
    );
  }

  private requireName(value: string) {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException('計畫名稱不可為空');
    return name;
  }

  private description(value?: string) {
    return String(value ?? '').trim();
  }
  private operator(value?: string) {
    return String(value || 'unknown').slice(0, 120);
  }

  private planResponse(plan: DegradedOperationPlan) {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? '',
      level: plan.level,
      speed_limit_kmh: plan.speedLimitKmh,
      version: plan.version,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    };
  }

  private executionResponse(
    execution: DegradedOperationExecution,
    message?: string,
  ) {
    return {
      execution_id: execution.id,
      source_plan_id: execution.sourcePlanId,
      name: execution.planName,
      description: execution.planDescription,
      level: execution.level,
      speed_limit_kmh: execution.speedLimitKmh,
      operator_id: execution.operatorId,
      execution_status: execution.executionStatus,
      control_status: execution.controlStatus,
      command_tracking: execution.commandTracking,
      schedule_mode: execution.scheduleMode,
      scheduled_for_operating: execution.scheduledForOperating,
      scheduled_timezone: execution.scheduledTimezone,
      started_at_operating: execution.startedAtOperating,
      started_at_real: execution.startedAtReal,
      ended_at_operating: execution.endedAtOperating,
      ended_at_real: execution.endedAtReal,
      restore_speed_limit_kmh: execution.restoreSpeedLimitKmh,
      restore_checks: execution.restoreChecks,
      error_reason: execution.errorReason,
      version: execution.version,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      message: message ?? '',
    };
  }

  private draftResponse(draft: DegradedOperationDraft) {
    return {
      key: draft.key,
      kind: draft.kind,
      value: draft.value,
      status: draft.status,
      version: draft.version,
      updated_at: draft.updatedAt,
    };
  }
}

function zonedParts(epoch: number, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epoch));
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
  } catch {
    throw new BadRequestException('無效的時區');
  }
}

function zonedEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let value = Date.UTC(year, month - 1, day, hour, minute);
  for (let index = 0; index < 3; index += 1) {
    const rendered = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const get = (type: string) =>
      Number(rendered.find((part) => part.type === type)?.value);
    const shown = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute);
    value += wanted - shown;
  }
  return value;
}
