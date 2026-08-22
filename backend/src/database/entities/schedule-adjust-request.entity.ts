import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum ScheduleAdjustStatus {
  PENDING = 'PENDING', // 待主管核准
  APPROVED = 'APPROVED', // 已核准
  REJECTED = 'REJECTED', // 已駁回
  APPLIED = 'APPLIED', // 已套用至營運
  CANCELLED = 'CANCELLED', // 已取消
}

/**
 * 規格書 §營運核心層 · 營運管理模組 · 班表部署管理
 *
 * 班表調整的待核准請求。啟用主管簽核時，新的班表調整先進入待核准，
 * 經核准後才套用至營運。
 *
 * <strong>為什麼要有這張表。</strong>待核准請求原本存在瀏覽器 localStorage
 * （syncdrive_vtms_pending_schedule_adjust）——送出請求的人與核准的主管通常不是
 * 同一台電腦，請求根本傳不到主管那裡；核准與否也沒有任何紀錄可稽核（2026-08-21）。
 */
@Entity('schedule_adjust_requests')
@Index('IDX_SCHEDULE_ADJUST_STATUS', ['status', 'submittedAt'])
@Index('IDX_SCHEDULE_ADJUST_SHIFT', ['shiftId'])
export class ScheduleAdjustRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shift_id' })
  shiftId: string;

  @Column({ name: 'shift_name' })
  shiftName: string;

  // 預定執行日期（YYYY-MM-DD）
  @Column({ name: 'exec_date' })
  execDate: string;

  // 預定執行時間（HH:mm）
  @Column({ name: 'exec_time' })
  execTime: string;

  @Column({ type: 'enum', enum: ScheduleAdjustStatus, default: ScheduleAdjustStatus.PENDING })
  status: ScheduleAdjustStatus;

  // 調整內容（異動的班次與整備時段）
  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ name: 'submitted_by' })
  submittedBy: string;

  @Column({ name: 'submitted_at', type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  submittedAt: number;

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewed_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  reviewedAt: number;

  // 駁回原因或核准備註
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
