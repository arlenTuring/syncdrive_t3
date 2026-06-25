import { Entity, Column, PrimaryColumn } from 'typeorm';

/** 儀表板運能趨勢示範：以 offset_minutes 相對「現在」產生 HH:mm */
@Entity('capacity_trend_demo_points')
export class CapacityTrendDemoPoint {
  @PrimaryColumn({ name: 'point_id', length: 32 })
  pointId: string;

  @Column({ name: 'demo_set_id', length: 16, default: 'DEMO' })
  demoSetId: string;

  /** 相對目前時間的分鐘偏移（負＝過去、正＝未來） */
  @Column({ name: 'offset_minutes', type: 'int' })
  offsetMinutes: number;

  /** 相容舊查詢；新圖表請用 actual_util / forecast_util */
  @Column({ type: 'int', nullable: true })
  utilization: number | null;

  /** 當前運行運能（過去～現在） */
  @Column({ name: 'actual_util', type: 'int', nullable: true })
  actualUtil: number | null;

  /** 預期今日運能走勢（現在～未來） */
  @Column({ name: 'forecast_util', type: 'int', nullable: true })
  forecastUtil: number | null;

  @Column({ name: 'line_segment', length: 16, default: 'normal' })
  lineSegment: string;

  /** 運能區段代碼（班次結構識別，顏色由前端規則對應） */
  @Column({ name: 'segment_code', length: 32, default: 'IN_SERVICE' })
  segmentCode: string;

  @Column({ name: 'is_anomaly', default: false })
  isAnomaly: boolean;

  @Column({ name: 'anomaly_label', length: 64, default: '' })
  anomalyLabel: string;
}
