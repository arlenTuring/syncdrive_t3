import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ScheduleAdjustRequest,
  ScheduleAdjustStatus,
} from '../database/entities/schedule-adjust-request.entity';

/**
 * 班表調整簽核請求（TP13C §1.4 營運排程 · schedule_adjust_requests）。
 *
 * <strong>為什麼要有這一支。</strong>待核准請求原本存在瀏覽器
 * <code>localStorage['syncdrive_vtms_pending_schedule_adjust']</code>——而送出申請的
 * 排班人員與核准的主管<strong>通常不是同一台電腦</strong>，請求根本傳不到主管那裡；
 * 核准或駁回也沒有留下任何可稽核的紀錄。這是簽核流程的必要條件，不是最佳化。
 */
export type CreateScheduleAdjustInput = {
  shiftId: string;
  shiftName?: string;
  execDate: string;
  execTime: string;
  submittedBy?: string;
  payload?: unknown;
};

export type ReviewScheduleAdjustInput = {
  status: ScheduleAdjustStatus;
  reviewedBy?: string;
  reviewNote?: string;
};

@Injectable()
export class ScheduleAdjustService {
  constructor(
    @InjectRepository(ScheduleAdjustRequest)
    private readonly repository: Repository<ScheduleAdjustRequest>,
  ) {}

  /**
   * 目前待核准的那一筆。
   *
   * 同一時間只該有一筆待核准——班表調整是整份套用，同時有兩筆待核准無法判斷該以
   * 哪一份為準。真的出現多筆時取<strong>最新送出</strong>的那一筆，並在建立時把
   * 更早的舊請求標成取消（見 {@link create}）。
   */
  async findPending(): Promise<ScheduleAdjustRequest | null> {
    const rows = await this.repository.find({
      where: { status: ScheduleAdjustStatus.PENDING },
      order: { submittedAt: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  async list(status?: ScheduleAdjustStatus): Promise<ScheduleAdjustRequest[]> {
    return this.repository.find({
      where: status ? { status } : {},
      order: { submittedAt: 'DESC' },
      take: 200,
    });
  }

  async create(
    input: CreateScheduleAdjustInput,
  ): Promise<ScheduleAdjustRequest> {
    const now = Date.now();
    // 新的申請送出時，先把還掛著的舊申請收掉——同時存在兩筆待核准無法判斷以哪份為準
    const stale = await this.repository.find({
      where: { status: ScheduleAdjustStatus.PENDING },
    });
    for (const row of stale) {
      row.status = ScheduleAdjustStatus.CANCELLED;
      row.reviewNote = '已被後續送出的申請取代';
      row.updatedAt = now;
      await this.repository.save(row);
    }

    const created = this.repository.create({
      shiftId: input.shiftId,
      shiftName: input.shiftName ?? '',
      execDate: input.execDate,
      execTime: input.execTime,
      status: ScheduleAdjustStatus.PENDING,
      payload: input.payload ?? null,
      submittedBy: input.submittedBy ?? '',
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return this.repository.save(created);
  }

  async review(
    id: string,
    input: ReviewScheduleAdjustInput,
  ): Promise<ScheduleAdjustRequest> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`找不到班表調整請求：${id}`);
    const now = Date.now();
    row.status = input.status;
    row.reviewedBy = input.reviewedBy ?? row.reviewedBy;
    row.reviewNote = input.reviewNote ?? row.reviewNote;
    row.reviewedAt = now;
    row.updatedAt = now;
    return this.repository.save(row);
  }

  /**
   * 把目前待核准的那一筆結案。
   *
   * 前端既有的 <code>writePendingScheduleAdjust(null)</code> 沒有帶結果——同一個呼叫
   * 同時用在「部署完成」與「駁回」兩條路徑上。分不出來時一律記
   * {@link ScheduleAdjustStatus.CANCELLED}：寧可留下「這筆不再待核准」這個事實，
   * 也不要捏造一個沒發生過的核准或駁回。呼叫端知道結果時應改用明確的狀態。
   */
  async resolvePending(
    status: ScheduleAdjustStatus = ScheduleAdjustStatus.CANCELLED,
    reviewedBy?: string,
    reviewNote?: string,
  ): Promise<ScheduleAdjustRequest | null> {
    const pending = await this.findPending();
    if (!pending) return null;
    return this.review(pending.id, { status, reviewedBy, reviewNote });
  }
}
