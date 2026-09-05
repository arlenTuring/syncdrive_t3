/**
 * 虛擬圍籬（Virtual Fence）— 場域管理模組下的事件警示用圍籬。
 * 與場域地圖編輯器的「電子圍籬」（Geofence 設施）完全獨立，不可混用。
 */

export const VIRTUAL_FENCE_KIND = 'virtual_fence' as const;
export const VIRTUAL_FENCE_PURPOSE = 'event_alert' as const;

export type FenceEnableFilter = 'all' | 'enabled' | 'disabled';

/** 作動行為（可複選；進入／離開各自獨立） */
export type FenceBehaviorKind = 'speed_limit' | 'publish_event';

export const FENCE_BEHAVIOR_OPTIONS: Array<{
  id: FenceBehaviorKind;
  label: string;
}> = [
  { id: 'speed_limit', label: '速度限制' },
  { id: 'publish_event', label: '發布事件' },
];

export type FenceCoverageSegment = {
  trackId: string;
  label: string;
};

/** 虛擬圍籬多邊形頂點（地圖內容像素座標） */
export type FenceVertex = { x: number; y: number };

/** 虛擬圍籬實體（事件警示），非地圖 Geofence */
export type VirtualFence = {
  /** 固定類別碼，與電子圍籬 Geofence 區隔 */
  kind: typeof VIRTUAL_FENCE_KIND;
  /** 用途：事件警示 */
  purpose: typeof VIRTUAL_FENCE_PURPOSE;
  id: string;
  mapId: string;
  name: string;
  enabled: boolean;
  coverage: FenceCoverageSegment[];
  /** 圍籬幾何；至少 3 點才視為有效多邊形 */
  vertices: FenceVertex[];
  enterBehaviors: FenceBehaviorKind[];
  leaveBehaviors: FenceBehaviorKind[];
  speedLimitKmh: number | null;
  updatedAt: number;
};

/** @deprecated 使用 VirtualFence；保留別名以相容面板 props */
export type FenceDetail = VirtualFence;

export type FenceListItem = {
  id: string;
  name: string;
  enabled: boolean;
};

export type FencePageMode =
  | { kind: 'browse' }
  | { kind: 'view'; fenceId: string }
  | { kind: 'edit'; fenceId: string }
  | { kind: 'create' };

export type FenceDraft = {
  name: string;
  enabled: boolean;
  coverage: FenceCoverageSegment[];
  vertices: FenceVertex[];
  enterBehaviors: FenceBehaviorKind[];
  leaveBehaviors: FenceBehaviorKind[];
  speedLimitKmh: number | null;
};

export const FENCE_ENABLE_STATUS = {
  enabled: {
    label: '啟用',
    style: {
      container: 'bg-[rgba(43,127,255,0.2)]',
      dot: 'bg-[#2B7FFF]',
    },
  },
  disabled: {
    label: '未啟用',
    style: {
      container: 'bg-transparent border border-zinc-600',
      dot: 'bg-[#99A1AF]',
    },
  },
} as const;

export function emptyFenceDraft(): FenceDraft {
  return {
    name: '',
    enabled: true,
    coverage: [],
    vertices: [],
    enterBehaviors: ['speed_limit'],
    leaveBehaviors: [],
    speedLimitKmh: 15,
  };
}

export function draftFromFence(fence: VirtualFence): FenceDraft {
  return {
    name: fence.name,
    enabled: fence.enabled,
    coverage: fence.coverage.map((c) => ({ ...c })),
    vertices: (fence.vertices ?? []).map((v) => ({ ...v })),
    enterBehaviors: [...fence.enterBehaviors],
    leaveBehaviors: [...fence.leaveBehaviors],
    speedLimitKmh: fence.speedLimitKmh,
  };
}

/** @deprecated 使用 draftFromFence */
export const draftFromDetail = draftFromFence;
