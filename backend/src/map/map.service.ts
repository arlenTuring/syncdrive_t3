import { Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapNodes = require(
  path.join(process.cwd(), 'scripts/map-operation-nodes.js'),
);

export type OperationNodeDto = {
  nodeId: string;
  nodeRole: string;
  stationName: string;
  routeStation?: string;
  dockingLeg?: 'down' | 'up';
  routeId?: string;
  actionType: string;
  xM: number;
  yM: number;
  facilityId: string;
  areaId: string;
};

@Injectable()
export class MapService {
  listPublishedMapIds(): string[] {
    return ['t3-main-version'];
  }

  getOperationNodes(mapId: string): {
    mapId: string;
    nodes: OperationNodeDto[];
  } {
    const mapPath = mapNodes.resolveMapJsonPath(mapId);
    if (!mapPath) {
      throw new NotFoundException(`Map not found: ${mapId}`);
    }
    const registry = mapNodes.loadOperationNodesFromMapFile(mapPath);
    return {
      mapId: registry.mapId ?? mapId,
      nodes: registry.nodes,
    };
  }
}
