import type { MapAreaObject } from '../../types/area';
import type { FacilityObject } from '../../types/facility';
import type { TrackGenIndex } from '../../utils/trackGenLocate';

/** 單段 Track refField（場域公尺）；renderArea 僅供圖台像素錨點，不參與場域定位 */
export type TrackNetworkSegment = {
  trackId: string;
  trackCode: string | null;
  bounds: {
    xMinM: number;
    xMaxM: number;
    yMinM: number;
    yMaxM: number;
  };
  horizontal: boolean;
  track: FacilityObject;
  renderArea: MapAreaObject;
};

export type TrackNetwork = {
  segments: TrackNetworkSegment[];
  /**
   * 生成軌道的定位索引：場域切格網找候選、`road:lane` 依里程排好。
   *
   * 沒有任何一塊帶著生成資料時為 null，定位就走舊的 refField 掃描。
   */
  genIndex: TrackGenIndex | null;
  /** facilityId → 該段；同一塊會因為代碼別名重複登記，這裡只留第一筆 */
  byTrackId: Map<string, TrackNetworkSegment>;
};

export type RefFieldOverlapReport = {
  segmentAId: string;
  segmentBId: string;
  overlapAreaM2: number;
};
