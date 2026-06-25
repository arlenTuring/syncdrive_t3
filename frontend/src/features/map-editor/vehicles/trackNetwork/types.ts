import type { MapAreaObject } from '../../types/area';
import type { FacilityObject } from '../../types/facility';

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
};

export type RefFieldOverlapReport = {
  segmentAId: string;
  segmentBId: string;
  overlapAreaM2: number;
};
