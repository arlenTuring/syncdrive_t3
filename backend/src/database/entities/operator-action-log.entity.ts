import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum OperatorActionType {
  COMMAND_DISPATCH = 'COMMAND_DISPATCH', // 下發控制指令
  ORDER_CREATE = 'ORDER_CREATE', // 建立訂單
  ORDER_UPDATE = 'ORDER_UPDATE', // 更新訂單狀態
  SPEED_LIMIT_SET = 'SPEED_LIMIT_SET', // 設定速限
  DIRECTION_CHANGE = 'DIRECTION_CHANGE', // 方向切換
}

export enum ActionResult {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

/**
 * 規格書 §系統操作紀錄 (System Operation Logs)
 * 記錄所有中心端操作員的操作行為，用於法律稽核與事故追溯。
 * 規格書要求：操作人員識別碼、時間戳記、來源位址 (IP)、操作行為與執行結果。
 */
@Entity('operator_action_logs')
@Index('IDX_ACTION_OPERATOR_TIME', ['operatorId', 'createdAt'])
@Index('IDX_ACTION_VEHICLE_TIME', ['targetVehicle', 'createdAt'])
@Index('IDX_ACTION_TYPE', ['actionType'])
export class OperatorActionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 操作員識別碼（未來接身份驗證系統；目前暫存為固定字串 "system" 或前端傳入）
  @Column({ name: 'operator_id', default: 'system' })
  operatorId: string;

  // 操作來源 IP（用於稽核）
  @Column({ name: 'source_ip', nullable: true })
  sourceIp: string;

  // 操作類型（閉鎖式 Enum）
  @Column({ type: 'enum', enum: OperatorActionType, name: 'action_type' })
  actionType: OperatorActionType;

  // 操作對象車輛（'all' 代表廣播全車隊）
  @Column({ name: 'target_vehicle', nullable: true })
  targetVehicle: string;

  // 操作內容詳情（如指令參數、訂單 ID 等）
  @Column({ type: 'jsonb', name: 'action_detail', nullable: true })
  actionDetail: any;

  // 執行結果
  @Column({ type: 'enum', enum: ActionResult })
  result: ActionResult;

  // 若失敗，記錄原因
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string;

  // 操作時間（Unix Epoch ms，13 位）
  @Column({
    type: 'bigint',
    name: 'created_at',
    default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)',
  })
  createdAt: string;
}
