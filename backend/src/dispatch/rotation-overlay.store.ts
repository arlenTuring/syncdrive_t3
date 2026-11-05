import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RotationOverlay } from './rotation.overlay';

/**
 * 派遣讀輪替結果的唯一入口。只讀已確認與已完成的項目：
 * 待確認、略過、中止的項目對計畫沒有任何影響。
 */
@Injectable()
export class RotationOverlayStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async overlaysUntil(day: string): Promise<RotationOverlay[]> {
    const rows: Array<{
      operating_day: string;
      effective_day: string;
      outgoing: string;
      incoming: string;
      shunts: RotationOverlay['shunts'];
      cancelled_order_ids: string[];
    }> = await this.dataSource.query(
      `SELECT operating_day, effective_day, outgoing, incoming, shunts, cancelled_order_ids
       FROM vehicle_rotation_items
       WHERE status IN ('confirmed', 'done') AND operating_day <= $1
       ORDER BY confirmed_at ASC, created_at ASC`,
      [day],
    );
    return rows.map((row) => ({
      operatingDay: row.operating_day,
      effectiveDay: row.effective_day,
      outgoing: row.outgoing,
      incoming: row.incoming,
      shunts: row.shunts,
      cancelledOrderIds: row.cancelled_order_ids,
    }));
  }
}
