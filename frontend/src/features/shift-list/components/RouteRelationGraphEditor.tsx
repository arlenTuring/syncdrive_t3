import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveSelectedRouteInstanceId } from '../types/create';
import { HelpTip } from './HelpTip';
import {
  addRouteRelationLink,
  reconnectRouteRelationLink,
  removeRouteRelationLink,
  resolveRouteOriginStation,
  resolveRouteRelationNextKind,
  resolveRouteTerminalStation,
  reverseRouteRelationLink,
  ROUTE_RELATION_TILE,
  syncRouteRelationGraphWithRoutes,
  updateRouteRelationLinkNextKind,
  updateRouteRelationNodePosition,
  type ShiftRouteRelationGraph,
  type ShiftRouteRelationLink,
} from '../utils/routeRelationGraph';

type AnchorKey = 'n' | 'e' | 's' | 'w';

type DragNodeState = {
  instanceId: string;
  originX: number;
  originY: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type LinkDraftState = {
  fromInstanceId: string;
  fromAnchor: AnchorKey;
  pointerX: number;
  pointerY: number;
  hoverTargetId: string | null;
  pointerId: number;
};

type ReconnectDraftState = {
  linkId: string;
  end: 'from' | 'to';
  fixedInstanceId: string;
  pointerX: number;
  pointerY: number;
  hoverTargetId: string | null;
  pointerId: number;
};

const ANCHOR_OFFSET = 6;
/** 游標靠近方塊邊緣／本體時吸附的距離（px） */
const SNAP_DISTANCE = 36;
/** 拖曳方塊時與其他方塊對齊的吸附距離（px） */
const ALIGN_THRESHOLD = 6;

type AlignGuides = {
  vertical: number[];
  horizontal: number[];
};

function resolveTileAlignment(
  rawX: number,
  rawY: number,
  others: Array<{ x: number; y: number }>,
  width = ROUTE_RELATION_TILE.width,
  height = ROUTE_RELATION_TILE.height,
  threshold = ALIGN_THRESHOLD,
): { x: number; y: number; guides: AlignGuides } {
  const targetXs: number[] = [];
  const targetYs: number[] = [];
  for (const other of others) {
    targetXs.push(other.x, other.x + width / 2, other.x + width);
    targetYs.push(other.y, other.y + height / 2, other.y + height);
  }

  const movingOffsetsX = [0, width / 2, width];
  const movingOffsetsY = [0, height / 2, height];

  let bestDx: { delta: number; guide: number } | null = null;
  for (const offset of movingOffsetsX) {
    const edge = rawX + offset;
    for (const target of targetXs) {
      const delta = target - edge;
      if (Math.abs(delta) > threshold) continue;
      if (!bestDx || Math.abs(delta) < Math.abs(bestDx.delta)) {
        bestDx = { delta, guide: target };
      }
    }
  }

  let bestDy: { delta: number; guide: number } | null = null;
  for (const offset of movingOffsetsY) {
    const edge = rawY + offset;
    for (const target of targetYs) {
      const delta = target - edge;
      if (Math.abs(delta) > threshold) continue;
      if (!bestDy || Math.abs(delta) < Math.abs(bestDy.delta)) {
        bestDy = { delta, guide: target };
      }
    }
  }

  const x = Math.max(8, rawX + (bestDx?.delta ?? 0));
  const y = Math.max(8, rawY + (bestDy?.delta ?? 0));
  const vertical = new Set<number>();
  const horizontal = new Set<number>();
  for (const offset of movingOffsetsX) {
    const edge = x + offset;
    for (const target of targetXs) {
      if (Math.abs(edge - target) <= 0.75) vertical.add(target);
    }
  }
  for (const offset of movingOffsetsY) {
    const edge = y + offset;
    for (const target of targetYs) {
      if (Math.abs(edge - target) <= 0.75) horizontal.add(target);
    }
  }

  return {
    x,
    y,
    guides: {
      vertical: [...vertical],
      horizontal: [...horizontal],
    },
  };
}

function anchorPoint(
  node: { x: number; y: number },
  anchor: AnchorKey,
): { x: number; y: number } {
  const cx = node.x + ROUTE_RELATION_TILE.width / 2;
  const cy = node.y + ROUTE_RELATION_TILE.height / 2;
  switch (anchor) {
    case 'n':
      return { x: cx, y: node.y - ANCHOR_OFFSET };
    case 's':
      return { x: cx, y: node.y + ROUTE_RELATION_TILE.height + ANCHOR_OFFSET };
    case 'w':
      return { x: node.x - ANCHOR_OFFSET, y: cy };
    case 'e':
      return { x: node.x + ROUTE_RELATION_TILE.width + ANCHOR_OFFSET, y: cy };
  }
}

function nearestAnchor(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { fromAnchor: AnchorKey; toAnchor: AnchorKey } {
  const fromCenters: Record<AnchorKey, { x: number; y: number }> = {
    n: { x: from.x + ROUTE_RELATION_TILE.width / 2, y: from.y },
    s: { x: from.x + ROUTE_RELATION_TILE.width / 2, y: from.y + ROUTE_RELATION_TILE.height },
    w: { x: from.x, y: from.y + ROUTE_RELATION_TILE.height / 2 },
    e: { x: from.x + ROUTE_RELATION_TILE.width, y: from.y + ROUTE_RELATION_TILE.height / 2 },
  };
  const toCenters: Record<AnchorKey, { x: number; y: number }> = {
    n: { x: to.x + ROUTE_RELATION_TILE.width / 2, y: to.y },
    s: { x: to.x + ROUTE_RELATION_TILE.width / 2, y: to.y + ROUTE_RELATION_TILE.height },
    w: { x: to.x, y: to.y + ROUTE_RELATION_TILE.height / 2 },
    e: { x: to.x + ROUTE_RELATION_TILE.width, y: to.y + ROUTE_RELATION_TILE.height / 2 },
  };
  let best: { fromAnchor: AnchorKey; toAnchor: AnchorKey; dist: number } | null = null;
  (Object.keys(fromCenters) as AnchorKey[]).forEach((fa) => {
    (Object.keys(toCenters) as AnchorKey[]).forEach((ta) => {
      const a = fromCenters[fa];
      const b = toCenters[ta];
      const dist = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (!best || dist < best.dist) best = { fromAnchor: fa, toAnchor: ta, dist };
    });
  });
  return best ?? { fromAnchor: 'e', toAnchor: 'w' };
}

/** 線段方向箭頭（放在比例位置，比端點 marker 更易辨識） */
function LinkDirectionArrow({
  x1,
  y1,
  x2,
  y2,
  t,
  fill,
  size = 10,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0～1，沿線段位置 */
  t: number;
  fill: string;
  size?: number;
}) {
  const mx = x1 + (x2 - x1) * t;
  const my = y1 + (y2 - y1) * t;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const halfL = size * 0.55;
  const halfW = size * 0.42;
  return (
    <polygon
      points={`${halfL},0 ${-halfL},${-halfW} ${-halfL},${halfW}`}
      fill={fill}
      transform={`translate(${mx} ${my}) rotate(${angle})`}
      className="pointer-events-none"
    />
  );
}

/** 兩節點之間，連到 target 的最近邊緣點（吸附用） */
function snapPointOnTile(
  target: { x: number; y: number },
  from: { x: number; y: number },
): { x: number; y: number } {
  const anchors = nearestAnchor(from, target);
  return anchorPoint(target, anchors.toAnchor);
}

function distanceToTile(boardX: number, boardY: number, node: { x: number; y: number }) {
  const left = node.x;
  const right = node.x + ROUTE_RELATION_TILE.width;
  const top = node.y;
  const bottom = node.y + ROUTE_RELATION_TILE.height;
  const cx = Math.min(Math.max(boardX, left), right);
  const cy = Math.min(Math.max(boardY, top), bottom);
  return Math.hypot(boardX - cx, boardY - cy);
}

type RouteRelationGraphEditorProps = {
  routes: ShiftScheduleSelectedRoute[];
  graph: ShiftRouteRelationGraph;
  onChange: (next: ShiftRouteRelationGraph) => void;
  /** 首班車路線 instanceId（單選） */
  headInstanceId?: string | null;
  /** 將某方塊設為首班車 */
  onSetHead?: (instanceId: string) => void;
  /** 由此起算（可複數） */
  startInstanceIds?: string[];
  /** 到此結算（可複數） */
  endInstanceIds?: string[];
  onToggleStartInstance?: (instanceId: string) => void;
  onToggleEndInstance?: (instanceId: string) => void;
  /** false 時不加外框，方便與下方區塊同一卡片延續 */
  framed?: boolean;
};

export function RouteRelationGraphEditor({
  routes,
  graph,
  onChange,
  headInstanceId = null,
  onSetHead,
  startInstanceIds = [],
  endInstanceIds = [],
  onToggleStartInstance,
  onToggleEndInstance,
  framed = true,
}: RouteRelationGraphEditorProps) {
  const { t } = useTranslation();
  const startSet = useMemo(() => new Set(startInstanceIds), [startInstanceIds]);
  const endSet = useMemo(() => new Set(endInstanceIds), [endInstanceIds]);
  const boardRef = useRef<HTMLDivElement>(null);
  /** 點選／拖曳方塊後，避免後續 board click 立刻清掉選取 */
  const suppressBoardClearRef = useRef(false);
  const [dragNode, setDragNode] = useState<DragNodeState | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraftState | null>(null);
  const [reconnectDraft, setReconnectDraft] = useState<ReconnectDraftState | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [alignGuides, setAlignGuides] = useState<AlignGuides | null>(null);

  const routeByInstanceId = useMemo(
    () =>
      new Map(
        routes.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
      ),
    [routes],
  );

  const synced = useMemo(
    () => syncRouteRelationGraphWithRoutes(graph, routes),
    [graph, routes],
  );

  const nodeById = useMemo(
    () => new Map(synced.nodes.map((node) => [node.instanceId, node] as const)),
    [synced.nodes],
  );

  const boardSize = useMemo(() => {
    let maxX = 420;
    let maxY = 280;
    for (const node of synced.nodes) {
      maxX = Math.max(maxX, node.x + ROUTE_RELATION_TILE.width + 48);
      maxY = Math.max(maxY, node.y + ROUTE_RELATION_TILE.height + 48);
    }
    return { width: maxX, height: maxY };
  }, [synced.nodes]);

  const clientToBoard = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** 命中方塊本體，或靠近方塊邊緣時磁性吸附 */
  const snapHitTestTile = (boardX: number, boardY: number, excludeId?: string) => {
    let bestId: string | null = null;
    let bestDist = SNAP_DISTANCE;
    for (let i = synced.nodes.length - 1; i >= 0; i -= 1) {
      const node = synced.nodes[i]!;
      if (excludeId && node.instanceId === excludeId) continue;
      const dist = distanceToTile(boardX, boardY, node);
      if (dist <= bestDist) {
        bestDist = dist;
        bestId = node.instanceId;
      }
    }
    return bestId;
  };

  const captureBoardPointer = (pointerId: number) => {
    boardRef.current?.setPointerCapture?.(pointerId);
  };

  const onNodePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    instanceId: string,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const node = nodeById.get(instanceId);
    if (!node) return;

    captureBoardPointer(event.pointerId);
    suppressBoardClearRef.current = true;
    setSelectedLinkId(null);
    setSelectedNodeId(instanceId);
    setAlignGuides(null);
    setReconnectDraft(null);
    setLinkDraft(null);
    setDragNode({
      instanceId,
      originX: node.x,
      originY: node.y,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    });
  };

  const onAnchorPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    instanceId: string,
    anchor: AnchorKey,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    captureBoardPointer(event.pointerId);
    const point = clientToBoard(event.clientX, event.clientY);
    setSelectedLinkId(null);
    setSelectedNodeId(null);
    setDragNode(null);
    setReconnectDraft(null);
    setLinkDraft({
      fromInstanceId: instanceId,
      fromAnchor: anchor,
      pointerX: point.x,
      pointerY: point.y,
      hoverTargetId: null,
      pointerId: event.pointerId,
    });
  };

  const onEndpointPointerDown = (
    event: ReactPointerEvent<SVGCircleElement>,
    link: ShiftRouteRelationLink,
    end: 'from' | 'to',
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    captureBoardPointer(event.pointerId);
    const fixedInstanceId = end === 'from' ? link.toInstanceId : link.fromInstanceId;
    const point = clientToBoard(event.clientX, event.clientY);
    setSelectedLinkId(link.id);
    setSelectedNodeId(null);
    setLinkDraft(null);
    setDragNode(null);
    setReconnectDraft({
      linkId: link.id,
      end,
      fixedInstanceId,
      pointerX: point.x,
      pointerY: point.y,
      hoverTargetId: snapHitTestTile(point.x, point.y, fixedInstanceId),
      pointerId: event.pointerId,
    });
  };

  const onBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragNode && event.pointerId === dragNode.pointerId) {
      const dx = event.clientX - dragNode.startClientX;
      const dy = event.clientY - dragNode.startClientY;
      const moved = dragNode.moved || Math.hypot(dx, dy) > 4;
      if (moved && !dragNode.moved) {
        setDragNode({ ...dragNode, moved: true });
      }
      if (!moved) return;
      const others = synced.nodes.filter((node) => node.instanceId !== dragNode.instanceId);
      const aligned = resolveTileAlignment(
        dragNode.originX + dx,
        dragNode.originY + dy,
        others,
      );
      setAlignGuides(
        aligned.guides.vertical.length > 0 || aligned.guides.horizontal.length > 0
          ? aligned.guides
          : null,
      );
      onChange(
        updateRouteRelationNodePosition(
          synced,
          dragNode.instanceId,
          aligned.x,
          aligned.y,
        ),
      );
      return;
    }
    if (alignGuides) setAlignGuides(null);
    if (linkDraft && event.pointerId === linkDraft.pointerId) {
      const point = clientToBoard(event.clientX, event.clientY);
      const hoverTargetId = snapHitTestTile(point.x, point.y, linkDraft.fromInstanceId);
      setLinkDraft({
        ...linkDraft,
        pointerX: point.x,
        pointerY: point.y,
        hoverTargetId,
      });
      return;
    }
    if (reconnectDraft && event.pointerId === reconnectDraft.pointerId) {
      const point = clientToBoard(event.clientX, event.clientY);
      const hoverTargetId = snapHitTestTile(
        point.x,
        point.y,
        reconnectDraft.fixedInstanceId,
      );
      setReconnectDraft({
        ...reconnectDraft,
        pointerX: point.x,
        pointerY: point.y,
        hoverTargetId,
      });
    }
  };

  const onBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragNode && event.pointerId === dragNode.pointerId) {
      // 選取已在 pointerdown 設定；拖曳後仍維持選取以便設起始路徑
      setAlignGuides(null);
      setDragNode(null);
      return;
    }
    if (alignGuides) setAlignGuides(null);
    if (linkDraft && event.pointerId === linkDraft.pointerId) {
      const point = clientToBoard(event.clientX, event.clientY);
      const targetId =
        linkDraft.hoverTargetId
        ?? snapHitTestTile(point.x, point.y, linkDraft.fromInstanceId);
      if (targetId) {
        onChange(addRouteRelationLink(synced, linkDraft.fromInstanceId, targetId));
      }
      setLinkDraft(null);
      return;
    }
    if (reconnectDraft && event.pointerId === reconnectDraft.pointerId) {
      const point = clientToBoard(event.clientX, event.clientY);
      const targetId =
        reconnectDraft.hoverTargetId
        ?? snapHitTestTile(point.x, point.y, reconnectDraft.fixedInstanceId);
      if (targetId) {
        const next = reconnectRouteRelationLink(
          synced,
          reconnectDraft.linkId,
          reconnectDraft.end,
          targetId,
        );
        onChange(next);
        const nextLink = next.links.find(
          (item) =>
            (reconnectDraft.end === 'from'
              && item.fromInstanceId === targetId
              && item.toInstanceId === reconnectDraft.fixedInstanceId)
            || (reconnectDraft.end === 'to'
              && item.toInstanceId === targetId
              && item.fromInstanceId === reconnectDraft.fixedInstanceId),
        );
        setSelectedLinkId(nextLink?.id ?? null);
      }
      setReconnectDraft(null);
    }
  };

  const renderLink = (link: ShiftRouteRelationLink) => {
    if (reconnectDraft?.linkId === link.id) return null;

    const fromNode = nodeById.get(link.fromInstanceId);
    const toNode = nodeById.get(link.toInstanceId);
    const fromRoute = routeByInstanceId.get(link.fromInstanceId);
    const toRoute = routeByInstanceId.get(link.toInstanceId);
    if (!fromNode || !toNode || !fromRoute || !toRoute) return null;

    const anchors = nearestAnchor(fromNode, toNode);
    const start = anchorPoint(fromNode, anchors.fromAnchor);
    const end = anchorPoint(toNode, anchors.toAnchor);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const selected = selectedLinkId === link.id;
    const nextKind = resolveRouteRelationNextKind(link);
    const isSecondary = nextKind === 'secondary';

    const stroke = selected
      ? (isSecondary ? '#8B7CF8' : '#2B7FFF')
      : (isSecondary ? '#7C72C8' : '#5B8DEF');
    const badgeFill = selected
      ? (isSecondary ? '#8B7CF8' : '#2B7FFF')
      : (isSecondary ? '#2E1065' : '#082F49');
    const badgeStroke = selected
      ? (isSecondary ? '#C4B5FD' : '#9ec5ff')
      : (isSecondary ? '#8B7CF8' : '#38BDF8');
    const badgeText = selected ? '#FFFFFF' : (isSecondary ? '#EDE9FE' : '#E0F2FE');
    const endpointFill = selected
      ? (isSecondary ? '#8B7CF8' : '#2B7FFF')
      : (isSecondary ? '#3D3568' : '#1E3A5F');
    const endpointStroke = selected
      ? (isSecondary ? '#C4B5FD' : '#9ec5ff')
      : (isSecondary ? '#9084D4' : '#5B8DEF');

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const badgeR = selected ? 11 : 10;
    const toBadge = {
      x: midX - ux * badgeR,
      y: midY - uy * badgeR,
    };
    const fromBadge = {
      x: midX + ux * badgeR,
      y: midY + uy * badgeR,
    };

    const selectLink = (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      setSelectedLinkId(link.id);
      setSelectedNodeId(null);
    };

    return (
      <g key={link.id}>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="transparent"
          strokeWidth={14}
          className="cursor-pointer"
          onClick={selectLink}
        />
        <line
          x1={start.x}
          y1={start.y}
          x2={toBadge.x}
          y2={toBadge.y}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.75}
          className="pointer-events-none"
        />
        <line
          x1={fromBadge.x}
          y1={fromBadge.y}
          x2={end.x}
          y2={end.y}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.75}
          className="pointer-events-none"
        />
        <LinkDirectionArrow
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          t={1 / 3}
          fill={stroke}
          size={selected ? 11 : 10}
        />
        <LinkDirectionArrow
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          t={2 / 3}
          fill={stroke}
          size={selected ? 11 : 10}
        />
        <circle
          cx={midX}
          cy={midY}
          r={badgeR}
          fill={badgeFill}
          stroke={badgeStroke}
          strokeWidth={1.5}
          className="cursor-pointer"
          onClick={selectLink}
        >
          <title>{isSecondary ? t('shiftList.routeRelation.secondaryTitle') : t('shiftList.routeRelation.primaryTitle')}</title>
        </circle>
        <text
          x={midX}
          y={midY}
          textAnchor="middle"
          dominantBaseline="central"
          fill={badgeText}
          fontSize={10}
          fontWeight={700}
          className="pointer-events-none select-none"
        >
          {isSecondary ? t('shiftList.routeRelation.secondaryShort') : t('shiftList.routeRelation.primaryShort')}
        </text>
        <circle
          cx={start.x}
          cy={start.y}
          r={12}
          fill="transparent"
          className="cursor-grab"
          onPointerDown={(event) => onEndpointPointerDown(event, link, 'from')}
        />
        <circle
          cx={start.x}
          cy={start.y}
          r={selected ? 6 : 5}
          fill={endpointFill}
          stroke={endpointStroke}
          strokeWidth={1.5}
          className="pointer-events-none"
        />
        <circle
          cx={end.x}
          cy={end.y}
          r={12}
          fill="transparent"
          className="cursor-grab"
          onPointerDown={(event) => onEndpointPointerDown(event, link, 'to')}
        />
        <circle
          cx={end.x}
          cy={end.y}
          r={selected ? 6 : 5}
          fill={endpointFill}
          stroke={endpointStroke}
          strokeWidth={1.5}
          className="pointer-events-none"
        />
      </g>
    );
  };

  if (routes.length === 0) return null;

  const draftFromNode = linkDraft ? nodeById.get(linkDraft.fromInstanceId) : null;
  const draftHoverNode = linkDraft?.hoverTargetId
    ? nodeById.get(linkDraft.hoverTargetId)
    : null;
  const draftStart = draftFromNode && linkDraft
    ? anchorPoint(draftFromNode, linkDraft.fromAnchor)
    : null;
  const draftEnd = draftFromNode && linkDraft
    ? (draftHoverNode
        ? snapPointOnTile(draftHoverNode, draftFromNode)
        : { x: linkDraft.pointerX, y: linkDraft.pointerY })
    : null;

  const reconnectFixedNode = reconnectDraft
    ? nodeById.get(reconnectDraft.fixedInstanceId)
    : null;
  const reconnectHoverNode = reconnectDraft?.hoverTargetId
    ? nodeById.get(reconnectDraft.hoverTargetId)
    : null;
  const reconnectGeometry = (() => {
    if (!reconnectDraft || !reconnectFixedNode) return null;
    const freeProbe = reconnectHoverNode
      ?? {
        x: reconnectDraft.pointerX - ROUTE_RELATION_TILE.width / 2,
        y: reconnectDraft.pointerY - ROUTE_RELATION_TILE.height / 2,
      };

    if (reconnectDraft.end === 'from') {
      const fromPt = reconnectHoverNode
        ? anchorPoint(
            reconnectHoverNode,
            nearestAnchor(reconnectHoverNode, reconnectFixedNode).fromAnchor,
          )
        : { x: reconnectDraft.pointerX, y: reconnectDraft.pointerY };
      const toPt = anchorPoint(
        reconnectFixedNode,
        nearestAnchor(freeProbe, reconnectFixedNode).toAnchor,
      );
      return { x1: fromPt.x, y1: fromPt.y, x2: toPt.x, y2: toPt.y, free: fromPt };
    }

    const fromPt = anchorPoint(
      reconnectFixedNode,
      nearestAnchor(reconnectFixedNode, freeProbe).fromAnchor,
    );
    const toPt = reconnectHoverNode
      ? snapPointOnTile(reconnectHoverNode, reconnectFixedNode)
      : { x: reconnectDraft.pointerX, y: reconnectDraft.pointerY };
    return { x1: fromPt.x, y1: fromPt.y, x2: toPt.x, y2: toPt.y, free: toPt };
  })();

  return (
    <div
      className={
        framed ? 'rounded-xl border border-zinc-800/80 bg-zinc-950/50' : undefined
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{t('shiftList.routeRelation.title')}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {t('shiftList.routeRelation.hint')}
          </p>
        </div>
        {selectedLinkId ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-zinc-700">
              <button
                type="button"
                onClick={() => {
                  onChange(updateRouteRelationLinkNextKind(synced, selectedLinkId, 'priority'));
                }}
                className={[
                  'px-2.5 py-1 text-[11px]',
                  resolveRouteRelationNextKind(
                    synced.links.find((link) => link.id === selectedLinkId),
                  ) === 'priority'
                    ? 'bg-[#2B7FFF]/25 text-[#9ec5ff]'
                    : 'text-zinc-400 hover:bg-sky-950/60 hover:text-sky-200',
                ].join(' ')}
              >
                {t('shiftList.routeRelation.primaryRoute')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(updateRouteRelationLinkNextKind(synced, selectedLinkId, 'secondary'));
                }}
                className={[
                  'border-l border-zinc-700 px-2.5 py-1 text-[11px]',
                  resolveRouteRelationNextKind(
                    synced.links.find((link) => link.id === selectedLinkId),
                  ) === 'secondary'
                    ? 'bg-violet-500/25 text-violet-100'
                    : 'text-zinc-400 hover:bg-violet-950/60 hover:text-violet-200',
                ].join(' ')}
              >
                {t('shiftList.routeRelation.secondaryRoute')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(reverseRouteRelationLink(synced, selectedLinkId));
                setSelectedLinkId(null);
              }}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-zinc-500"
            >
              {t('shiftList.routeRelation.reverseDirection')}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(removeRouteRelationLink(synced, selectedLinkId));
                setSelectedLinkId(null);
              }}
              className="rounded-md border border-rose-500/40 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/10"
            >
              {t('shiftList.routeRelation.deleteEdge')}
            </button>
          </div>
        ) : routes.length > 0 &&
          (onSetHead || onToggleStartInstance || onToggleEndInstance) ? (
          <div className="flex flex-wrap items-center gap-2">
            <HelpTip label={t('shiftList.routeRelation.markHelp')} widthClass="w-64">
              <div className="space-y-1.5">
                <p>{t('shiftList.routeRelation.markHelpSelect')}</p>
                <p>
                  <span className="text-amber-200">{t('shiftList.routeRelation.firstTrip')}</span>
                  {t('shiftList.routeRelation.firstTripHint')}
                </p>
                <p>
                  <span className="text-sky-200">{t('shiftList.routeRelation.startFrom')}</span>
                  {t('shiftList.routeRelation.startFromHint')}
                </p>
                <p>
                  <span className="text-violet-200">{t('shiftList.routeRelation.endAt')}</span>
                  {t('shiftList.routeRelation.endAtHint')}
                </p>
              </div>
            </HelpTip>
            {selectedNodeId ? (
              <>
                {onSetHead ? (
                  headInstanceId === selectedNodeId ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                      <Check className="size-3.5" strokeWidth={2.5} />
                      {t('shiftList.routeRelation.alreadyFirst')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSetHead(selectedNodeId)}
                      className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
                    >
                      {t('shiftList.routeRelation.setFirst')}
                    </button>
                  )
                ) : null}
                {onToggleStartInstance ? (
                  <button
                    type="button"
                    disabled={endSet.has(selectedNodeId) && !startSet.has(selectedNodeId)}
                    onClick={() => onToggleStartInstance(selectedNodeId)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]',
                      startSet.has(selectedNodeId)
                        ? 'border-sky-500/50 bg-sky-500/20 text-sky-100'
                        : endSet.has(selectedNodeId)
                          ? 'cursor-not-allowed border-zinc-800 text-zinc-600'
                          : 'border-zinc-700 text-zinc-300 hover:border-sky-500/40 hover:text-sky-100',
                    ].join(' ')}
                    title={
                      endSet.has(selectedNodeId) && !startSet.has(selectedNodeId)
                        ? t('shiftList.routeRelation.clearStartBlocked')
                        : undefined
                    }
                  >
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-sky-500/30 text-[9px] font-semibold text-sky-100">
                      {t('shiftList.routeRelation.startShort')}
                    </span>
                    {startSet.has(selectedNodeId) ? t('shiftList.routeRelation.cancelStart') : t('shiftList.routeRelation.startFrom')}
                  </button>
                ) : null}
                {onToggleEndInstance ? (
                  <button
                    type="button"
                    disabled={startSet.has(selectedNodeId) && !endSet.has(selectedNodeId)}
                    onClick={() => onToggleEndInstance(selectedNodeId)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]',
                      endSet.has(selectedNodeId)
                        ? 'border-violet-500/50 bg-violet-500/20 text-violet-100'
                        : startSet.has(selectedNodeId)
                          ? 'cursor-not-allowed border-zinc-800 text-zinc-600'
                          : 'border-zinc-700 text-zinc-300 hover:border-violet-500/40 hover:text-violet-100',
                    ].join(' ')}
                    title={
                      startSet.has(selectedNodeId) && !endSet.has(selectedNodeId)
                        ? t('shiftList.routeRelation.clearEndBlocked')
                        : undefined
                    }
                  >
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-violet-500/30 text-[9px] font-semibold text-violet-100">
                      {t('shiftList.routeRelation.endShort')}
                    </span>
                    {endSet.has(selectedNodeId) ? t('shiftList.routeRelation.cancelEnd') : t('shiftList.routeRelation.endAt')}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {onSetHead ? (
                  <span
                    className={[
                      'inline-flex items-center gap-1',
                      headInstanceId ? 'text-emerald-300' : 'text-zinc-600',
                    ].join(' ')}
                  >
                    {headInstanceId ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : (
                      <span className="inline-block size-3.5 rounded-full border border-zinc-700" />
                    )}
                    {t('shiftList.routeRelation.firstTrip')}
                  </span>
                ) : null}
                {onToggleStartInstance ? (
                  <span
                    className={[
                      'inline-flex items-center gap-1',
                      startSet.size > 0 ? 'text-emerald-300' : 'text-zinc-600',
                    ].join(' ')}
                  >
                    {startSet.size > 0 ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : (
                      <span className="inline-block size-3.5 rounded-full border border-zinc-700" />
                    )}
                    {t('shiftList.routeRelation.startLabel')}
                    {startSet.size > 0 ? (
                      <span className="tabular-nums text-zinc-500">{startSet.size}</span>
                    ) : null}
                  </span>
                ) : null}
                {onToggleEndInstance ? (
                  <span
                    className={[
                      'inline-flex items-center gap-1',
                      endSet.size > 0 ? 'text-emerald-300' : 'text-zinc-600',
                    ].join(' ')}
                  >
                    {endSet.size > 0 ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : (
                      <span className="inline-block size-3.5 rounded-full border border-zinc-700" />
                    )}
                    {t('shiftList.routeRelation.endLabel')}
                    {endSet.size > 0 ? (
                      <span className="tabular-nums text-zinc-500">{endSet.size}</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div
        ref={boardRef}
        className="relative overflow-auto"
        style={{ height: Math.min(420, Math.max(260, boardSize.height + 24)) }}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerLeave={onBoardPointerUp}
        onClick={(event) => {
          if (suppressBoardClearRef.current) {
            suppressBoardClearRef.current = false;
            return;
          }
          const target = event.target as Element | null;
          if (target?.closest?.('[data-relation-node]')) return;
          setSelectedLinkId(null);
          setSelectedNodeId(null);
        }}
      >
        <div
          className="relative"
          style={{ width: boardSize.width, height: boardSize.height, minWidth: '100%' }}
        >
          {synced.nodes.map((node) => {
            const route = routeByInstanceId.get(node.instanceId);
            if (!route) return null;
            const code = route.routeCode?.trim() || '—';
            const origin = resolveRouteOriginStation(route);
            const terminal = resolveRouteTerminalStation(route);
            const hovered =
              linkDraft?.hoverTargetId === node.instanceId
              || reconnectDraft?.hoverTargetId === node.instanceId;
            const isHead = headInstanceId === node.instanceId;
            const isSelected = selectedNodeId === node.instanceId;
            const isStart = startSet.has(node.instanceId);
            const isEnd = endSet.has(node.instanceId);
            return (
              <div
                key={node.instanceId}
                data-relation-node={node.instanceId}
                className={[
                  'absolute z-0 select-none rounded-lg border shadow-sm',
                  isHead
                    ? 'border-amber-400/70 bg-amber-950/55'
                    : 'border-zinc-700/90 bg-zinc-900/95',
                  hovered
                    ? 'ring-2 ring-[#2B7FFF]/50'
                    : isSelected
                      ? 'ring-1 ring-amber-400/50'
                      : '',
                ].join(' ')}
                style={{
                  left: node.x,
                  top: node.y,
                  width: ROUTE_RELATION_TILE.width,
                  height: ROUTE_RELATION_TILE.height,
                }}
                onPointerDown={(event) => onNodePointerDown(event, node.instanceId)}
                onClick={(event) => {
                  event.stopPropagation();
                  suppressBoardClearRef.current = false;
                  setSelectedNodeId(node.instanceId);
                  setSelectedLinkId(null);
                }}
              >
                {isHead ? (
                  <div className="pointer-events-none absolute left-1.5 top-1 z-30 rounded bg-amber-500/90 px-1 py-px text-[8px] font-semibold tracking-wide text-zinc-950">
                    {t('shiftList.routeRelation.firstTrip')}
                  </div>
                ) : null}
                {isStart ? (
                  <span
                    className="pointer-events-none absolute right-1.5 top-1 z-30 inline-flex size-4 items-center justify-center rounded-full bg-sky-500/35 text-[9px] font-semibold text-sky-50"
                    title={t('shiftList.routeRelation.startFrom')}
                    aria-label={t('shiftList.routeRelation.startFrom')}
                  >
                    {t('shiftList.routeRelation.startShort')}
                  </span>
                ) : null}
                {isEnd ? (
                  <span
                    className="pointer-events-none absolute right-1.5 top-1 z-30 inline-flex size-4 items-center justify-center rounded-full bg-violet-500/35 text-[9px] font-semibold text-violet-50"
                    title={t('shiftList.routeRelation.endAt')}
                    aria-label={t('shiftList.routeRelation.endAt')}
                  >
                    {t('shiftList.routeRelation.endShort')}
                  </span>
                ) : null}
                <div className="flex h-full flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 text-center">
                  <div
                    className={[
                      'text-lg font-semibold tracking-wide',
                      isHead ? 'text-amber-100' : 'text-[#7CB8FF]',
                    ].join(' ')}
                  >
                    {code}
                  </div>
                  <div
                    className="max-w-full truncate text-[9px] leading-tight text-zinc-400"
                    title={route.routeName}
                  >
                    {route.routeName}
                  </div>
                  <div
                    className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap border-t border-zinc-800/90 pt-1 text-[10px] leading-tight text-zinc-300 [scrollbar-width:thin]"
                    title={`${origin?.stationName ?? '—'} → ${terminal?.stationName ?? '—'}`}
                  >
                    <span className="text-zinc-500">{t('shiftList.routeRelation.origin')}</span>
                    {' '}
                    {origin?.stationName ?? '—'}
                    <span className="mx-1 text-zinc-600">→</span>
                    <span className="text-zinc-500">{t('shiftList.routeRelation.terminus')}</span>
                    {' '}
                    {terminal?.stationName ?? '—'}
                  </div>
                </div>
              </div>
            );
          })}

          <svg
            className="pointer-events-none absolute inset-0 z-10"
            width={boardSize.width}
            height={boardSize.height}
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="route-relation-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill="#71717a" />
              </marker>
            </defs>
            <g style={{ pointerEvents: 'auto' }}>
              {synced.links.map((link) => renderLink(link))}
            </g>
            {alignGuides ? (
              <g className="pointer-events-none">
                {alignGuides.vertical.map((x) => (
                  <line
                    key={`v-${x}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={boardSize.height}
                    stroke="#F472B6"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.9}
                  />
                ))}
                {alignGuides.horizontal.map((y) => (
                  <line
                    key={`h-${y}`}
                    x1={0}
                    y1={y}
                    x2={boardSize.width}
                    y2={y}
                    stroke="#F472B6"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.9}
                  />
                ))}
              </g>
            ) : null}
            {draftStart && draftEnd && linkDraft ? (
              <g>
                <line
                  x1={draftStart.x}
                  y1={draftStart.y}
                  x2={draftEnd.x}
                  y2={draftEnd.y}
                  stroke={linkDraft.hoverTargetId ? '#2B7FFF' : '#52525b'}
                  strokeWidth={linkDraft.hoverTargetId ? 2.25 : 1.5}
                  strokeDasharray="5 4"
                  markerEnd="url(#route-relation-arrow)"
                />
                {linkDraft.hoverTargetId ? (
                  <circle
                    cx={draftEnd.x}
                    cy={draftEnd.y}
                    r={6}
                    fill="#2B7FFF"
                    stroke="#9ec5ff"
                    strokeWidth={1.5}
                  />
                ) : null}
              </g>
            ) : null}
            {reconnectGeometry && reconnectDraft ? (
              <g>
                <line
                  x1={reconnectGeometry.x1}
                  y1={reconnectGeometry.y1}
                  x2={reconnectGeometry.x2}
                  y2={reconnectGeometry.y2}
                  stroke={reconnectDraft.hoverTargetId ? '#2B7FFF' : '#52525b'}
                  strokeWidth={reconnectDraft.hoverTargetId ? 2.25 : 1.5}
                  strokeDasharray="5 4"
                  markerEnd="url(#route-relation-arrow)"
                />
                <circle
                  cx={reconnectGeometry.free.x}
                  cy={reconnectGeometry.free.y}
                  r={6}
                  fill="#2B7FFF"
                  stroke="#9ec5ff"
                  strokeWidth={1.5}
                />
              </g>
            ) : null}
          </svg>

          {/* 四邊菱形拉線點：疊在連線層之上，避免被 SVG 擋到拖不到 */}
          {synced.nodes.flatMap((node) => {
            const route = routeByInstanceId.get(node.instanceId);
            if (!route) return [];
            const code = route.routeCode?.trim() || '—';
            const anchors: AnchorKey[] = ['n', 'e', 's', 'w'];
            return anchors.map((anchor) => {
              const pt = anchorPoint(node, anchor);
              return (
                <button
                  key={`${node.instanceId}-${anchor}`}
                  type="button"
                  aria-label={t('shiftList.routeRelation.dragHandleAria', { code, anchor })}
                  title={t('shiftList.routeRelation.dragHandle')}
                  className="absolute z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-zinc-400 bg-zinc-700 hover:border-[#2B7FFF] hover:bg-[#2B7FFF]"
                  style={{ left: pt.x, top: pt.y }}
                  onPointerDown={(event) =>
                    onAnchorPointerDown(event, node.instanceId, anchor)
                  }
                />
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
