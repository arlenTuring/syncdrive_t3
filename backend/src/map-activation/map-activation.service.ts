import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  DatasourceInvalidationService,
  DS_TAGS,
} from '../events/datasource-invalidation.service';
import { MapService } from '../map/map.service';
import { OperationShiftService } from '../operation-shift/operation-shift.service';
import {
  checkMapActivation,
  mapDocumentRoutes,
  type ActivationCheckResult,
} from './map-activation';

type ActivateBody = {
  libraryId?: string;
  displayName?: string;
  version?: string;
  updatedAt?: string;
  mapDocument?: Record<string, unknown>;
};

/** 設為主要地圖：先檢查部署中的班表接不接得上，再切換並通知儀表板重讀（規則見 map-activation.ts） */
@Injectable()
export class MapActivationService {
  private readonly logger = new Logger(MapActivationService.name);

  constructor(
    private readonly mapService: MapService,
    private readonly operationShiftService: OperationShiftService,
    private readonly invalidation: DatasourceInvalidationService,
  ) {}

  async check(mapId: string): Promise<ActivationCheckResult> {
    const id = mapId.trim();
    // 後端沒有這張（還沒存上來）就丟 404：前端會先把最新內容存上來再檢查
    const entry = this.mapService.getPublishedMapLibrary(id);
    const stations = this.mapService.getOperationNodes(id).stations;
    const status = this.mapService.getActiveMapLibraryStatus();
    // 設定檔裡的名稱是設成主要地圖那一刻的，之後改名不會跟著變；以地圖本身為準
    const activeName =
      this.mapService
        .listPublishedMapLibrary()
        .maps.find((map) => map.mapId === status.activeMapId)?.displayName ??
      status.activeDisplayName ??
      null;
    const deployed = await this.operationShiftService.getDeployedShift();
    const routes = mapDocumentRoutes(entry.mapDocument);
    /*
     * 點位＝停靠站＋這張圖路線上用到的所有點。路線還會經過途經點、折返點
     * （例如 s2w_d2u_back_start），它們不在停靠站清單裡，但確實是這張圖上的點。
     */
    const stationIds = new Set(stations.map((station) => station.stationId));
    for (const route of routes)
      for (const stationId of route.stationIds) stationIds.add(stationId);
    return checkMapActivation({
      candidate: {
        mapId: id,
        displayName: entry.displayName ?? null,
        routes,
        stationIds,
      },
      currentActive: { mapId: status.activeMapId, displayName: activeName },
      deployedShift: deployed,
    });
  }

  async activate(mapId: string, body: ActivateBody) {
    const id = mapId.trim();
    // 帶了最新內容就先存，檢查才會用到這一版
    if (body.mapDocument) {
      await this.mapService.publishMapLibrary(id, {
        libraryId: body.libraryId,
        displayName: body.displayName,
        version: body.version,
        updatedAt: body.updatedAt,
        mapDocument: body.mapDocument,
      });
    }
    const check = await this.check(id);
    if (!check.canActivate) {
      throw new ConflictException({
        message: '這張地圖目前不能設為主要地圖',
        check,
      });
    }
    const result = await this.mapService.setActiveMapLibrary({
      mapId: id,
      libraryId: body.libraryId,
      displayName: body.displayName,
    });
    this.logger.log(`主要地圖改為 ${id}（原本 ${check.currentActive.mapId}）`);
    // 車輛定位、整備格位、班次站點都跟著地圖走：讓儀表板全部重讀
    this.invalidation.emit(
      [
        DS_TAGS.VEHICLE_MONITOR,
        DS_TAGS.VEHICLE_MONITOR_TABLE,
        DS_TAGS.VEHICLE_DISTRIBUTION,
        DS_TAGS.MAINTENANCE_SLOTS,
        DS_TAGS.MAINLINE_SHIFTS,
        DS_TAGS.MAINTENANCE_SHIFTS,
        DS_TAGS.SHIFT_CENTER,
        'domain:active_map',
      ],
      'active_map_changed',
    );
    return {
      ok: true,
      activeMapId: result.activeMapId,
      activeLibraryId: result.activeLibraryId,
      check,
    };
  }
}
