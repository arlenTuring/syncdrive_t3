import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RotationOverlay } from './rotation.overlay';

const NEVER = '9999-12-31';

/**
 * 派遣讀輪替結果的唯一入口。只讀已確認與已完成的項目：
 * 待確認、略過、中止的項目對計畫沒有任何影響。
 */
@Injectable()
export class RotationOverlayStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async overlaysUntil(day: string): Promise<RotationOverlay[]> {
    const rows: Array<{
      status: string;
      operating_day: string;
      effective_day: string;
      outgoing: string;
      incoming: string;
      shunts: RotationOverlay['shunts'];
      cancelled_order_ids: string[];
    }> = await this.dataSource.query(
      `SELECT status, operating_day, effective_day, outgoing, incoming, shunts, cancelled_order_ids
       FROM vehicle_rotation_items
       WHERE status IN ('confirmed', 'done', 'aborted') AND operating_day <= $1
       ORDER BY confirmed_at ASC, created_at ASC`,
      [day],
    );
    return rows.map((row) => {
      // 中止的輪替不對調，只留下「已由輪替補發」的任務不要再由派遣發一次
      if (row.status === 'aborted') {
        return {
          operatingDay: row.operating_day,
          effectiveDay: NEVER,
          outgoing: row.outgoing,
          incoming: row.incoming,
          shunts: [],
          cancelledOrderIds: row.cancelled_order_ids,
        };
      }
      // 計畫裡只放第一段接替調車；回場要等接替車到位，由輪替監看依現場狀況下單
      return {
        operatingDay: row.operating_day,
        effectiveDay: row.effective_day,
        outgoing: row.outgoing,
        incoming: row.incoming,
        shunts: row.shunts.slice(0, 1),
        cancelledOrderIds: row.cancelled_order_ids,
      };
    });
  }
}
