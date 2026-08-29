import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ExternalApi } from '../../common/external-api.decorator';
import {
  ETA_COUNT_PARAM_MAX,
  ETA_COUNT_PARAM_MIN,
  vehicleEtaConfig,
} from './vehicle-eta.config';
import {
  EtaErrorDto,
  VehicleEtaByStationResponseDto,
  VehicleEtaByVehicleResponseDto,
} from './vehicle-eta.dto';
import { VehicleEtaService } from './vehicle-eta.service';

/**
 * 車輛即時 ETA 對外介面（規格書第五、六章）。
 *
 * 與班表計畫 ETA 是兩支不同的東西，不互相取代：計畫值來自已發布班表、沒有車輛識別；
 * 即時值來自車端回報、帶 <code>vehicle_code</code>。兩者的計畫時刻同源，可直接比對。
 */
@ApiTags('Vehicles')
@Controller('syncdrive-api/vehicles/eta')
export class VehicleEtaController {
  constructor(private readonly vehicleEtaService: VehicleEtaService) {}

  @Get('by-station')
  @ExternalApi('車輛即時 ETA')
  @ApiOperation({
    summary: '各停靠點接下來將抵達的車輛',
    description:
      '以停靠點為主鍵，回傳各停靠點接下來將抵達之車輛。' +
      '一律列出全部停靠點，當下無車輛駛近者 etas 為空陣列。' +
      '每站之 etas 依 eta_at 由近至遠排序。建議輪詢間隔 60 秒。',
  })
  @ApiQuery({
    name: 'station_id',
    required: false,
    description:
      '指定停靠點，可重複指定多個（如 ?station_id=station_3&station_id=station_4）',
  })
  @ApiQuery({
    name: 'limit_per_station',
    required: false,
    description: `每站回傳筆數，值域 ${ETA_COUNT_PARAM_MIN}–${ETA_COUNT_PARAM_MAX}`,
    schema: { type: 'integer', default: 3 },
  })
  @ApiOkResponse({ type: VehicleEtaByStationResponseDto })
  @ApiBadRequestResponse({ type: EtaErrorDto, description: '參數格式錯誤' })
  async byStation(
    @Query('station_id') stationId?: string | string[],
    @Query('limit_per_station') limitPerStation?: string,
  ): Promise<VehicleEtaByStationResponseDto> {
    return this.vehicleEtaService.getByStation({
      stationIds: toStringArray(stationId),
      limitPerStation: parseCountParam(
        limitPerStation,
        vehicleEtaConfig.defaultLimitPerStation,
        'limit_per_station',
      ),
    });
  }

  @Get('by-vehicle')
  @ExternalApi('車輛即時 ETA')
  @ApiOperation({
    summary: '各車輛接下來將抵達的停靠點',
    description:
      '以車輛為主鍵，回傳各車輛接下來將抵達之停靠點。' +
      'next_stops 中 sequence 為 1 者取自車端回報之 current_leg，' +
      'sequence 2 以後由中心端依班表計畫時刻外推。建議輪詢間隔 60 秒。',
  })
  @ApiQuery({
    name: 'vehicle_code',
    required: false,
    description:
      '指定車輛，可重複指定多個（如 ?vehicle_code=PMS-01&vehicle_code=PMS-05）',
  })
  @ApiQuery({
    name: 'next_stops',
    required: false,
    description: `每車往後推算站數，值域 ${ETA_COUNT_PARAM_MIN}–${ETA_COUNT_PARAM_MAX}`,
    schema: { type: 'integer', default: 3 },
  })
  @ApiOkResponse({ type: VehicleEtaByVehicleResponseDto })
  @ApiBadRequestResponse({ type: EtaErrorDto, description: '參數格式錯誤' })
  async byVehicle(
    @Query('vehicle_code') vehicleCode?: string | string[],
    @Query('next_stops') nextStops?: string,
  ): Promise<VehicleEtaByVehicleResponseDto> {
    return this.vehicleEtaService.getByVehicle({
      vehicleCodes: toStringArray(vehicleCode),
      nextStops: parseCountParam(
        nextStops,
        vehicleEtaConfig.defaultNextStops,
        'next_stops',
      ),
    });
  }
}

/** 同名查詢參數可重複指定；express 給的是字串或字串陣列 */
function toStringArray(
  raw: string | string[] | undefined,
): string[] | undefined {
  if (raw == null) return undefined;
  const list = (Array.isArray(raw) ? raw : [raw])
    .map((item) => String(item).trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * 規格書 9.1：參數不合法時回 <code>INVALID_PARAM</code> 與 400，而不是默默改成預設值。
 * 廠商照文件送錯值時要看得到錯，不然會以為自己送的參數生效了。
 */
function parseCountParam(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < ETA_COUNT_PARAM_MIN ||
    value > ETA_COUNT_PARAM_MAX
  ) {
    throw new BadRequestException({
      error: 'INVALID_PARAM',
      detail: `${name} 必須為 ${ETA_COUNT_PARAM_MIN} 至 ${ETA_COUNT_PARAM_MAX} 的整數`,
    });
  }
  return value;
}
