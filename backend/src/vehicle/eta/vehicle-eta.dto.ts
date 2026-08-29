import { ApiProperty } from '@nestjs/swagger';

/**
 * 車輛即時 ETA 對外回應模型。
 *
 * 每一個欄位都對應《車輛即時 ETA API 規格書》第七章。這些類別存在的唯一理由是
 * <strong>讓 Swagger 產得出結構</strong>——廠商拿到的是這份 schema，不是我方的 TypeScript
 * 型別。所以說明文字寫給廠商看，欄位名稱一律 snake_case 照規格，不照後端命名習慣。
 *
 * <code>*_at</code> 為 13 位 Unix Epoch 毫秒（權威值），每一個都有成對的
 * <code>*_clock</code>（當地 HH:MM:SS，顯示用）；兩者不一致時以 <code>*_at</code> 為準。
 */

export class EtaMetaDto {
  @ApiProperty({
    example: 1786842000000,
    description: '中心端產生本次快照的時刻',
  })
  generated_at!: number;

  @ApiProperty({
    example: '09:00:00',
    description: '可直接顯示為「資料更新於」',
  })
  generated_clock!: string;

  @ApiProperty({
    nullable: true,
    example: 'OS-DRAFT-MSEEXIN9',
    description: '計畫值所依據的班表；無可用班表時為 null',
  })
  shift_id!: string | null;

  @ApiProperty({
    enum: ['published', 'draft_fallback', 'none'],
    description:
      'published＝已發布班表；draft_fallback＝草稿，計畫值僅供參考，不得作為正式時刻使用；' +
      'none＝無班表，plan 全為 null',
  })
  source!: 'published' | 'draft_fallback' | 'none';

  @ApiProperty({
    enum: ['OK', 'DEGRADED', 'DOWN'],
    description:
      'DEGRADED＝部分車輛逾時或班表未載入，須對 UNKNOWN 者標示資料中斷；' +
      'DOWN＝無法取得任何車輛資料，必須停止顯示 ETA',
  })
  data_quality!: 'OK' | 'DEGRADED' | 'DOWN';
}

export class EtaPlanDto {
  @ApiProperty({ nullable: true, example: 1786842010000 })
  planned_arrival_at!: number | null;

  @ApiProperty({ nullable: true, example: '09:00:10' })
  planned_arrival_clock!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      '僅於該停靠點為此班次起站，或 arrival_state 為 AT_STATION 時有值',
  })
  planned_departure_at!: number | null;

  @ApiProperty({ nullable: true })
  planned_departure_clock!: string | null;

  @ApiProperty({
    nullable: true,
    example: 13,
    description: 'eta_at 減 planned_arrival_at，單位秒。正值＝晚於計畫',
  })
  delay_seconds!: number | null;

  @ApiProperty({
    enum: ['EARLY', 'ON_TIME', 'MINOR_DELAY', 'MAJOR_DELAY', 'NO_PLAN'],
    description: '暫定定義，門檻未經營運確認。現階段請以 delay_seconds 為準',
  })
  delay_state!: string;
}

/** by-station：某一站底下的一筆車輛預測 */
export class StationEtaEntryDto {
  @ApiProperty({ example: 'PMS-05' })
  vehicle_code!: string;

  @ApiProperty({ nullable: true, example: '260816-ST0007' })
  order_id!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'ST0007',
    description: '路線代號＋發車時刻 HHMM',
  })
  trip_code!: string | null;

  @ApiProperty({ nullable: true, example: 'ST' })
  route_code!: string | null;

  @ApiProperty({ nullable: true, example: 'S2W上行 > T3上行' })
  route_name!: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['TRANSITING', 'FAULTED'],
    description: '車端營運階段，原值透傳；資料逾時或車端未提供時為 null',
  })
  vehicle_phase!: string | null;

  @ApiProperty({
    enum: [
      'EN_ROUTE',
      'APPROACHING',
      'DOCKING',
      'AT_STATION',
      'DEPARTED',
      'UNKNOWN',
    ],
    description:
      'APPROACHING＝即將進站（eta ≤ 60 秒或距離 ≤ 200 公尺）；EN_ROUTE＝預計到達；' +
      'UNKNOWN＝車端資料逾時或缺少目標站',
  })
  arrival_state!: string;

  @ApiProperty({
    nullable: true,
    example: 25,
    description: '以 observed_at 為基準的剩餘秒數，非以收到回應的時刻為基準',
  })
  eta_seconds!: number | null;

  @ApiProperty({
    nullable: true,
    example: 1786842023000,
    description:
      '恆等於 observed_at + eta_seconds × 1000。倒數計時必須用這個欄位',
  })
  eta_at!: number | null;

  @ApiProperty({ nullable: true, example: '09:00:23' })
  eta_clock!: string | null;

  @ApiProperty({
    nullable: true,
    example: 120.0,
    description: '路徑距離，公尺',
  })
  distance_to_station_m!: number | null;

  @ApiProperty({ type: EtaPlanDto })
  plan!: EtaPlanDto;

  @ApiProperty({ example: 1786841998000, description: '車端回報時刻' })
  observed_at!: number;

  @ApiProperty({ example: '08:59:58' })
  observed_clock!: string;

  @ApiProperty({
    example: 2,
    description:
      'generated_at 減 observed_at。失聯是以「資料變舊」呈現而非欄位消失，' +
      '不可只用欄位是否存在判斷',
  })
  data_age_seconds!: number;
}

export class StationEtaGroupDto {
  @ApiProperty({ example: 'station_4' })
  station_id!: string;

  @ApiProperty({ example: 'T3上行' })
  station_name!: string;

  @ApiProperty({
    type: [StationEtaEntryDto],
    description: '依 eta_at 由近到遠排序；當下無車駛近時為空陣列',
  })
  etas!: StationEtaEntryDto[];
}

export class VehicleEtaByStationResponseDto {
  @ApiProperty({ type: EtaMetaDto })
  meta!: EtaMetaDto;

  @ApiProperty({
    example: 10,
    description: '等於 stations 陣列長度；未指定 station_id 時為全部停靠點',
  })
  station_count!: number;

  @ApiProperty({ type: [StationEtaGroupDto] })
  stations!: StationEtaGroupDto[];
}

export class VehiclePositionDto {
  @ApiProperty({ example: 25.077612, description: 'WGS84 緯度' })
  latitude!: number;

  @ApiProperty({ example: 121.232545, description: 'WGS84 經度' })
  longitude!: number;

  @ApiProperty({ example: 1.49, description: '車頭朝向角，弳度' })
  heading!: number;

  @ApiProperty({ example: 10.5, description: '公里／小時' })
  velocity_kph!: number;
}

export class VehicleNextStopDto {
  @ApiProperty({
    example: 1,
    description:
      '自 1 起算。sequence=1 為車端當前目標站，eta 直接採用車端回報值；' +
      '2 以後由中心端依班表站間旅行時間外推，誤差隨站序累積',
  })
  sequence!: number;

  @ApiProperty({ example: 'station_4' })
  station_id!: string;

  @ApiProperty({ example: 'T3上行' })
  station_name!: string;

  @ApiProperty({
    enum: [
      'EN_ROUTE',
      'APPROACHING',
      'DOCKING',
      'AT_STATION',
      'DEPARTED',
      'UNKNOWN',
    ],
  })
  arrival_state!: string;

  @ApiProperty({ nullable: true, example: 25 })
  eta_seconds!: number | null;

  @ApiProperty({ nullable: true, example: 1786842023000 })
  eta_at!: number | null;

  @ApiProperty({ nullable: true, example: '09:00:23' })
  eta_clock!: string | null;

  @ApiProperty({ nullable: true, example: 120.0 })
  distance_to_station_m!: number | null;

  @ApiProperty({ type: EtaPlanDto })
  plan!: EtaPlanDto;
}

export class VehicleEtaEntryDto {
  @ApiProperty({ example: 'PMS-05' })
  vehicle_code!: string;

  @ApiProperty({ nullable: true, enum: ['TRANSITING', 'FAULTED'] })
  vehicle_phase!: string | null;

  @ApiProperty({ nullable: true, example: '260816-ST0007' })
  order_id!: string | null;

  @ApiProperty({ nullable: true, example: 'ST0007' })
  trip_code!: string | null;

  @ApiProperty({ nullable: true, example: 'ST' })
  route_code!: string | null;

  @ApiProperty({ nullable: true, example: 'S2W上行 > T3上行' })
  route_name!: string | null;

  @ApiProperty({
    type: VehiclePositionDto,
    nullable: true,
    description: '車端資料逾時時為 null',
  })
  position!: VehiclePositionDto | null;

  @ApiProperty({ type: [VehicleNextStopDto] })
  next_stops!: VehicleNextStopDto[];

  @ApiProperty({ example: 1786841998000 })
  observed_at!: number;

  @ApiProperty({ example: '08:59:58' })
  observed_clock!: string;

  @ApiProperty({ example: 2 })
  data_age_seconds!: number;
}

export class VehicleEtaByVehicleResponseDto {
  @ApiProperty({ type: EtaMetaDto })
  meta!: EtaMetaDto;

  @ApiProperty({ example: 11, description: '等於 vehicles 陣列長度' })
  vehicle_count!: number;

  @ApiProperty({ type: [VehicleEtaEntryDto] })
  vehicles!: VehicleEtaEntryDto[];
}

/** 規格書 9.1：錯誤回應格式 */
export class EtaErrorDto {
  @ApiProperty({
    enum: [
      'INVALID_PARAM',
      'UNAUTHORIZED',
      'NOT_FOUND',
      'RATE_LIMITED',
      'SERVICE_DEGRADED',
    ],
  })
  error!: string;

  @ApiProperty({ example: 'limit_per_station 必須為 1 至 10 的整數' })
  detail!: string;
}
