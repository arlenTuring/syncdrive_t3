import { ApiProperty } from '@nestjs/swagger';

/**
 * 班表計畫值對外回應模型。
 *
 * 這些類別存在的唯一理由是<strong>讓 Swagger 產得出結構</strong>——協力廠商拿到的是
 * 這份 schema，不是我方的 TypeScript 型別。所以說明文字寫給廠商看，欄位名稱一律
 * snake_case 照《班表 Timetable API》規格，不照後端命名習慣。
 *
 * <strong>時刻一律是「當日第幾秒」與 HH:MM:SS，不是 Epoch。</strong>這一組是計畫值，
 * 描述的是「班表上排定的時刻」，本身不綁日期；即時 ETA 那一組才用 Epoch 毫秒，
 * 因為它描述的是真實世界的某一刻。兩者不要混用。
 */

export class TimetableMetaDto {
  @ApiProperty({ example: 'OS-DRAFT-MSEEXIN9', description: '這份班表的識別碼' })
  shift_id!: string;

  @ApiProperty({ example: '模擬正線' })
  name!: string;

  @ApiProperty({ enum: ['draft', 'published'], description: '班表本身的發布狀態' })
  publish_status!: string;

  @ApiProperty({
    enum: ['published', 'draft_fallback'],
    description:
      'published＝讀到已發布班表；draft_fallback＝庫內沒有已發布的，退而取用最新草稿，'
      + '此時時刻僅供參考，不應對外顯示為正式時刻',
  })
  source!: string;

  @ApiProperty({ nullable: true, example: '2026-08-19T00:53:59.220Z', description: '班表產生時刻' })
  generated_at!: string | null;

  @ApiProperty({ example: '1787115236800', description: '最後更新（Epoch 毫秒字串）' })
  updated_at!: string;

  @ApiProperty({ nullable: true, description: '這份班表所依據的地圖' })
  map_id!: string | null;
}

export class TimetableFilterDto {
  @ApiProperty({ example: '00:00:00' })
  from!: string;

  @ApiProperty({ example: '24:00:00' })
  to!: string;

  @ApiProperty({ example: 0, description: '當日第幾秒' })
  from_second!: number;

  @ApiProperty({ example: 86400 })
  to_second!: number;
}

export class TimetableTripStationDto {
  @ApiProperty({ example: 1, description: '站序，自 1 起算' })
  order!: number;

  @ApiProperty({ example: 'station_4' })
  station_id!: string;

  @ApiProperty({ example: 'T3上行' })
  station_name!: string;

  @ApiProperty({
    enum: ['origin', 'intermediate', 'terminal'],
    description:
      'origin＝只看 departure（arrival 固定 null，抵達屬上一卡末站）；'
      + 'intermediate＝arrival ＋ departure；'
      + 'terminal＝arrival ＋ dwell_complete（完成靠站，不稱出發）',
  })
  role!: string;

  @ApiProperty({ nullable: true, example: '00:10:40', description: '計畫抵達；起站為 null' })
  arrival!: string | null;

  @ApiProperty({ nullable: true, example: '00:07:40', description: '計畫離站；末站為 null' })
  departure!: string | null;

  @ApiProperty({
    nullable: true,
    example: '00:11:30',
    description: '靠站完成（＝該班次卡結束）。僅末站有值',
  })
  dwell_complete!: string | null;

  @ApiProperty({ example: 40, description: '設定的靠站秒數，不含緩衝' })
  base_dwell_seconds!: number;

  @ApiProperty({ example: 50, description: '有效靠站秒數，含緩衝' })
  dwell_seconds!: number;

  @ApiProperty({ nullable: true, example: 100, description: '到下一站的行駛秒數；末站為 null' })
  travel_to_next_seconds!: number | null;
}

export class TimetableTripDto {
  @ApiProperty({ example: 'ST0007', description: '路線代號＋發車時刻 HHMM' })
  trip_code!: string;

  @ApiProperty({ example: 'task-1786018029893-faqq', description: '班次卡的內部識別碼' })
  block_id!: string;

  @ApiProperty({ example: 1, description: '這一趟屬於班表上的第幾列' })
  timeline_row!: number;

  @ApiProperty({
    example: 'passenger',
    description:
      '回傳全部任務類型：passenger 正線、servicing 保養、inspection 行檢、'
      + 'charging 充電、standby 待命、dispatch 調度等。整備類通常無站序，stations 為空陣列',
  })
  task_type!: string;

  @ApiProperty({ example: '正線' })
  label!: string;

  @ApiProperty({ example: 'template_bar', description: '這張卡的產生來源' })
  source!: string;

  @ApiProperty({ nullable: true })
  route_id!: string | null;

  @ApiProperty({ nullable: true, example: 'ST' })
  route_code!: string | null;

  @ApiProperty({ nullable: true, example: 'S2W上行 > T3上行' })
  route_name!: string | null;

  @ApiProperty({ example: '00:07:40', description: '班次卡開始（＝起站 departure）' })
  card_start!: string;

  @ApiProperty({ example: '00:11:30', description: '班次卡結束（＝末站 dwell_complete）' })
  card_end!: string;

  @ApiProperty({ example: 460 })
  card_start_second!: number;

  @ApiProperty({ example: 690 })
  card_end_second!: number;

  @ApiProperty({ type: [TimetableTripStationDto] })
  stations!: TimetableTripStationDto[];
}

export class TimetableTripsResponseDto {
  @ApiProperty({ type: TimetableMetaDto })
  meta!: TimetableMetaDto;

  @ApiProperty({ type: TimetableFilterDto })
  filter!: TimetableFilterDto;

  @ApiProperty({ example: 26 })
  trip_count!: number;

  @ApiProperty({ type: [TimetableTripDto] })
  trips!: TimetableTripDto[];
}

// ── 站點計畫 ETA ────────────────────────────────────────────

export class StationEtaFilterDto extends TimetableFilterDto {
  @ApiProperty({ nullable: true, example: 'station_4' })
  station_id!: string | null;

  @ApiProperty({ example: true, description: '固定為 true：只回正線班次的站點事件' })
  passenger_stops_only!: boolean;
}

export class StationEtaEventDto {
  @ApiProperty({ example: 'station_4' })
  station_id!: string;

  @ApiProperty({ example: 'T3上行', description: '地圖上的停靠點別名，顯示用主標題' })
  station_alias!: string;

  @ApiProperty({ example: 'T3上行', description: '路線站序上的名稱' })
  station_name!: string;

  @ApiProperty({ enum: ['origin', 'intermediate', 'terminal'] })
  role!: string;

  @ApiProperty({ nullable: true, example: '00:10:40', description: '計畫抵達；起站為 null' })
  eta_arrive!: string | null;

  @ApiProperty({
    nullable: true,
    example: '00:11:30',
    description: '起站／途經＝出發；末站＝靠站完成（即該班次卡結束）',
  })
  eta_depart!: string | null;

  @ApiProperty({ nullable: true, example: 640 })
  eta_arrive_second!: number | null;

  @ApiProperty({ nullable: true, example: 690 })
  eta_depart_second!: number | null;

  @ApiProperty({ example: false, description: '到站與離站同一秒（不停靠／途經）' })
  non_stop!: boolean;

  @ApiProperty({ example: 36 })
  base_dwell_seconds!: number;

  @ApiProperty({ example: 50 })
  dwell_seconds!: number;

  @ApiProperty({ example: 14, description: '有效停靠 − 設定停靠，恆 ≥ 0' })
  buffer_seconds!: number;

  @ApiProperty({ example: 'ST0007' })
  trip_code!: string;

  @ApiProperty({ example: 'b-st' })
  block_id!: string;

  @ApiProperty({ example: 1 })
  timeline_row!: number;

  @ApiProperty({ nullable: true, example: 'ST' })
  route_code!: string | null;

  @ApiProperty({ nullable: true, example: 'S2W上行 > T3上行' })
  route_name!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '<strong>固定為 null。</strong>計畫值不含車輛對應——哪一列由哪一台車擔任，'
      + '是當日才決定的。要車輛識別請改用即時 ETA 介面。',
  })
  vehicle_id!: string | null;
}

export class StationEtaGroupDto {
  @ApiProperty({ example: 'station_4' })
  station_id!: string;

  @ApiProperty({ example: 'T3上行' })
  station_alias!: string;

  @ApiProperty({ example: 'T3上行' })
  station_name!: string;

  @ApiProperty({ example: 2 })
  eta_count!: number;

  @ApiProperty({ type: [StationEtaEventDto] })
  etas!: StationEtaEventDto[];
}

export class StationEtasResponseDto {
  @ApiProperty({ type: TimetableMetaDto })
  meta!: TimetableMetaDto;

  @ApiProperty({ type: StationEtaFilterDto })
  filter!: StationEtaFilterDto;

  @ApiProperty({ example: 4 })
  eta_count!: number;

  @ApiProperty({ type: [StationEtaEventDto], description: '依時間排序的站點事件流' })
  etas!: StationEtaEventDto[];

  @ApiProperty({
    type: [StationEtaGroupDto],
    description:
      '同一份事件依停靠點分組。<strong>會列出地圖上全部停靠點</strong>，包含目前沒有'
      + '任何班次的（etas 為空陣列），方便站端固定顯示版面而不必自己補齊清單。',
  })
  stations!: StationEtaGroupDto[];
}
