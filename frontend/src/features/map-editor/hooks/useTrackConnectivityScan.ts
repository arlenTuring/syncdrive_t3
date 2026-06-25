import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { MapAreaObject } from '../types/area';
import {
  buildParallelScanPlan,
  interpolatePathAtDistance,
  pathDistanceForIndex,
  trackDisplayLabel,
  issueInvolvedTrackIds,
  type ConnectivityIssue,
  type ParallelScanPlan,
  type ScanChainIssue,
  type ScanPathPoint,
  type SegmentScanTask,
} from '../utils/trackConnectivityScan';
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types';

export type ConnectivityScanPhase =
  | 'idle'
  | 'scanning'
  | 'flashing'
  | 'complete';

/** 同時運行的探針上限（其餘排隊，避免一次 70 點齊發） */
export const MAX_CONCURRENT_PROBES = 6;

/** content px / sec（504 × 2） */
const SCAN_PX_PER_SEC = 1008;

const TRAIL_BEHIND_PX = 28;

export type ScanLaserVisual = {
  trackId: string;
  laserPx: { x: number; y: number };
  laserTrailPx: { x: number; y: number };
  /** 掃到問題並停下的探針 */
  discovering?: boolean;
};

export type ConnectivityScanState = {
  phase: ConnectivityScanPhase;
  plan: ParallelScanPlan | null;
  segmentById: Map<string, TrackNetworkSegment> | null;
  progressPercent: number;
  activeProbeCount: number;
  totalProbeCount: number;
  maxConcurrentProbes: number;
  lasers: ScanLaserVisual[];
  /** 發現問題的那支探針（trackId） */
  discoveringTrackId: string | null;
  activeIssue: ConnectivityIssue | null;
  /** 附近可能涉及的軌道（不高亮單一「問題元件」） */
  highlightTrackIds: string[];
  flashing: boolean;
  revealedIssues: ConnectivityIssue[];
  totalIssues: number;
};

type TaskRuntime = {
  distancePx: number;
  prevDistancePx: number;
  issueIndex: number;
  done: boolean;
};

type AdvanceStatus = 'continue' | 'paused' | 'complete';

type RevealHit = {
  taskIndex: number;
  issue: ConnectivityIssue;
  point: ScanPathPoint;
  pathIndex: number;
  revealDistancePx: number;
};

export function useTrackConnectivityScan(areas: MapAreaObject[]) {
  const [state, setState] = useState<ConnectivityScanState>({
    phase: 'idle',
    plan: null,
    segmentById: null,
    progressPercent: 0,
    activeProbeCount: 0,
    totalProbeCount: 0,
    maxConcurrentProbes: MAX_CONCURRENT_PROBES,
    lasers: [],
    discoveringTrackId: null,
    activeIssue: null,
    highlightTrackIds: [],
    flashing: false,
    revealedIssues: [],
    totalIssues: 0,
  });

  const rafRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const scanningRef = useRef(false);
  const planRef = useRef<ParallelScanPlan | null>(null);
  const tasksRef = useRef<SegmentScanTask[]>([]);
  const runtimeRef = useRef<TaskRuntime[]>([]);
  const activeTaskIndicesRef = useRef<number[]>([]);
  const queuedTaskIndicesRef = useRef<number[]>([]);
  const completedTaskCountRef = useRef(0);
  const revealedIssuesRef = useRef<ConnectivityIssue[]>([]);
  const activeTaskIndexRef = useRef(-1);
  const advanceScanRef = useRef<(dtSec: number) => AdvanceStatus>(() => 'complete');

  const cancelRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    lastFrameTsRef.current = 0;
  }, []);

  const stopScanningLoop = useCallback(() => {
    scanningRef.current = false;
    cancelRaf();
  }, [cancelRaf]);

  const scheduleStep = useCallback(() => {
    if (!scanningRef.current || rafRef.current) return;
    rafRef.current = requestAnimationFrame((ts) => {
      rafRef.current = 0;
      if (!scanningRef.current) return;

      const last = lastFrameTsRef.current;
      const dt = last > 0 ? Math.min((ts - last) / 1000, 0.033) : 1 / 60;
      lastFrameTsRef.current = ts;

      const status = advanceScanRef.current(dt);
      if (status === 'continue' && scanningRef.current) {
        scheduleStep();
      }
    });
  }, []);

  const fillProbePool = useCallback(() => {
    while (
      activeTaskIndicesRef.current.length < MAX_CONCURRENT_PROBES &&
      queuedTaskIndicesRef.current.length > 0
    ) {
      activeTaskIndicesRef.current.push(queuedTaskIndicesRef.current.shift()!);
    }
  }, []);

  const retireCompletedTask = useCallback(
    (taskIndex: number) => {
      activeTaskIndicesRef.current = activeTaskIndicesRef.current.filter(
        (ti) => ti !== taskIndex,
      );
      completedTaskCountRef.current += 1;
      fillProbePool();
    },
    [fillProbePool],
  );

  const computeProgress = useCallback(
    (tasks: SegmentScanTask[], runtime: TaskRuntime[]) => {
      if (tasks.length === 0) {
        return { progressPercent: 100, activeProbeCount: 0 };
      }
      let sum = completedTaskCountRef.current;
      for (const ti of activeTaskIndicesRef.current) {
        const t = tasks[ti]!;
        const r = runtime[ti]!;
        if (r.done) continue;
        sum += Math.min(1, r.distancePx / t.totalLengthPx);
      }
      return {
        progressPercent: Math.round((sum / tasks.length) * 1000) / 10,
        activeProbeCount: activeTaskIndicesRef.current.filter(
          (ti) => !runtime[ti]?.done,
        ).length,
      };
    },
    [],
  );

  const laserAtDistance = useCallback(
    (
      task: SegmentScanTask,
      distancePx: number,
      discovering = false,
    ): ScanLaserVisual => {
      const at = interpolatePathAtDistance(task.path, distancePx);
      const behind = interpolatePathAtDistance(
        task.path,
        Math.max(0, distancePx - TRAIL_BEHIND_PX),
      );
      return {
        trackId: task.trackId,
        laserPx: at.laserPx,
        laserTrailPx: behind.laserPx,
        discovering,
      };
    },
    [],
  );

  const buildLaserVisuals = useCallback(
    (
      tasks: SegmentScanTask[],
      runtime: TaskRuntime[],
      discoveringTaskIndex: number | null = null,
    ): ScanLaserVisual[] => {
      const lasers: ScanLaserVisual[] = [];
      for (const ti of activeTaskIndicesRef.current) {
        const task = tasks[ti]!;
        const r = runtime[ti]!;
        if (r.done) continue;
        lasers.push(
          laserAtDistance(task, r.distancePx, ti === discoveringTaskIndex),
        );
      }
      return lasers;
    },
    [laserAtDistance],
  );

  const publishScanningState = useCallback(
    (tasks: SegmentScanTask[], runtime: TaskRuntime[]) => {
      const { progressPercent, activeProbeCount } = computeProgress(tasks, runtime);
      flushSync(() => {
        setState((s) => ({
          ...s,
          phase: 'scanning',
          progressPercent,
          activeProbeCount,
          totalProbeCount: tasks.length,
          maxConcurrentProbes: MAX_CONCURRENT_PROBES,
          lasers: buildLaserVisuals(tasks, runtime),
          discoveringTrackId: null,
          activeIssue: null,
          highlightTrackIds: [],
          flashing: false,
        }));
      });
    },
    [buildLaserVisuals, computeProgress],
  );

  const resetPool = useCallback((taskCount: number) => {
    completedTaskCountRef.current = 0;
    const cap = Math.min(MAX_CONCURRENT_PROBES, taskCount);
    activeTaskIndicesRef.current = Array.from({ length: cap }, (_, i) => i);
    queuedTaskIndicesRef.current =
      taskCount > cap
        ? Array.from({ length: taskCount - cap }, (_, i) => i + cap)
        : [];
  }, []);

  const pauseAtDiscoveringProbe = useCallback(
    (
      hit: RevealHit,
      tasks: SegmentScanTask[],
      runtime: TaskRuntime[],
    ) => {
      stopScanningLoop();
      const { taskIndex, issue, revealDistancePx } = hit;
      activeTaskIndexRef.current = taskIndex;
      revealedIssuesRef.current = [...revealedIssuesRef.current, issue];

      const rt = runtime[taskIndex]!;
      rt.distancePx = revealDistancePx;
      rt.prevDistancePx = revealDistancePx;

      const discoveringTrackId = tasks[taskIndex]!.trackId;
      const { progressPercent, activeProbeCount } = computeProgress(tasks, runtime);

      flushSync(() => {
        setState((s) => ({
          ...s,
          phase: 'flashing',
          activeIssue: issue,
          highlightTrackIds: issueInvolvedTrackIds(issue),
          discoveringTrackId,
          progressPercent,
          activeProbeCount,
          lasers: buildLaserVisuals(tasks, runtime, taskIndex),
          flashing: true,
          revealedIssues: revealedIssuesRef.current,
        }));
      });
    },
    [buildLaserVisuals, computeProgress, stopScanningLoop],
  );

  const stopScan = useCallback(() => {
    stopScanningLoop();
    setState((s) => ({
      ...s,
      phase: 'idle',
      lasers: [],
      progressPercent: 0,
      activeProbeCount: 0,
      discoveringTrackId: null,
      flashing: false,
      activeIssue: null,
      highlightTrackIds: [],
    }));
  }, [stopScanningLoop]);

  const resetScan = useCallback(() => {
    stopScanningLoop();
    planRef.current = null;
    tasksRef.current = [];
    runtimeRef.current = [];
    activeTaskIndicesRef.current = [];
    queuedTaskIndicesRef.current = [];
    completedTaskCountRef.current = 0;
    revealedIssuesRef.current = [];
    activeTaskIndexRef.current = -1;
    setState({
      phase: 'idle',
      plan: null,
      segmentById: null,
      progressPercent: 0,
      activeProbeCount: 0,
      totalProbeCount: 0,
      maxConcurrentProbes: MAX_CONCURRENT_PROBES,
      lasers: [],
      discoveringTrackId: null,
      activeIssue: null,
      highlightTrackIds: [],
      flashing: false,
      revealedIssues: [],
      totalIssues: 0,
    });
  }, [stopScanningLoop]);

  const completeScan = useCallback(() => {
    stopScanningLoop();
    const plan = planRef.current;
    const totalProbeCount = tasksRef.current.length;
    flushSync(() => {
      setState((s) => ({
        ...s,
        phase: 'complete',
        plan,
        segmentById: plan?.segmentById ?? s.segmentById,
        progressPercent: 100,
        activeProbeCount: 0,
        totalProbeCount,
        lasers: [],
        discoveringTrackId: null,
        highlightTrackIds: [],
        activeIssue: null,
        flashing: false,
        revealedIssues: revealedIssuesRef.current,
        totalIssues: revealedIssuesRef.current.length,
      }));
    });
  }, [stopScanningLoop]);

  const pendingForTask = (task: SegmentScanTask, issueIndex: number): ScanChainIssue | null =>
    task.pendingIssues[issueIndex] ?? null;

  const advanceScan = useCallback(
    (dtSec: number): AdvanceStatus => {
      const plan = planRef.current;
      const tasks = tasksRef.current;
      const runtime = runtimeRef.current;
      if (!plan || tasks.length === 0) return 'complete';

      const stepPx = SCAN_PX_PER_SEC * dtSec;
      let revealHit: RevealHit | null = null;

      for (const ti of [...activeTaskIndicesRef.current]) {
        const task = tasks[ti]!;
        const rt = runtime[ti]!;
        if (rt.done) continue;

        const pending = pendingForTask(task, rt.issueIndex);
        const prevDist = rt.prevDistancePx;
        const prev = rt.distancePx;
        let next = Math.min(prev + stepPx, task.totalLengthPx);
        if (pending) {
          next = Math.min(next, pending.revealDistancePx);
        }

        const prevIdx = Math.floor(
          interpolatePathAtDistance(task.path, prev).pathIndex,
        );
        const nextIdx = Math.floor(
          interpolatePathAtDistance(task.path, next).pathIndex,
        );
        for (let idx = prevIdx + 1; idx <= nextIdx && idx < task.path.length; idx++) {
          const pt = task.path[idx]!;
          if (!fieldPointCovered(pt, plan)) {
            const snapDist = pathDistanceForIndex(task.path, idx);
            rt.distancePx = snapDist;
            rt.prevDistancePx = prevDist;
            revealHit = {
              taskIndex: ti,
              issue: {
                kind: 'path_gap',
                trackId: pt.trackId,
                trackCode: plan.segmentById.get(pt.trackId)?.trackCode ?? null,
                areaId: plan.segmentById.get(pt.trackId)?.renderArea.id ?? '',
                message: `${trackDisplayLabel(plan.segmentById.get(pt.trackId), pt.trackId)} 掃描點 (${pt.xM.toFixed(2)}, ${pt.yM.toFixed(2)}) 不在 refField 內`,
                fieldPoint: { xM: pt.xM, yM: pt.yM },
              },
              point: pt,
              pathIndex: idx,
              revealDistancePx: snapDist,
            };
            break;
          }
        }
        if (revealHit) break;

        rt.distancePx = next;

        if (
          pending &&
          prevDist < pending.revealDistancePx &&
          next >= pending.revealDistancePx
        ) {
          rt.distancePx = pending.revealDistancePx;
          rt.prevDistancePx = prevDist;
          revealHit = {
            taskIndex: ti,
            issue: pending.issue,
            point: task.path[pending.revealIndex]!,
            pathIndex: pending.revealIndex,
            revealDistancePx: pending.revealDistancePx,
          };
          break;
        }

        rt.prevDistancePx = next;

        if (next >= task.totalLengthPx) {
          rt.done = true;
          retireCompletedTask(ti);
        }
      }

      if (revealHit) {
        pauseAtDiscoveringProbe(revealHit, tasks, runtime);
        return 'paused';
      }

      if (completedTaskCountRef.current >= tasks.length) {
        publishScanningState(tasks, runtime);
        completeScan();
        return 'complete';
      }

      publishScanningState(tasks, runtime);
      return 'continue';
    },
    [completeScan, pauseAtDiscoveringProbe, publishScanningState, retireCompletedTask],
  );

  useEffect(() => {
    advanceScanRef.current = advanceScan;
  }, [advanceScan]);

  const startScan = useCallback(() => {
    stopScanningLoop();
    revealedIssuesRef.current = [];
    activeTaskIndexRef.current = -1;

    const plan = buildParallelScanPlan(areas);
    planRef.current = plan;
    tasksRef.current = plan.tasks;
    runtimeRef.current = plan.tasks.map(() => ({
      distancePx: 0,
      prevDistancePx: -1,
      issueIndex: 0,
      done: false,
    }));
    resetPool(plan.tasks.length);

    if (plan.tasks.length === 0) {
      setState((s) => ({
        ...s,
        phase: 'complete',
        plan,
        segmentById: plan.segmentById,
        progressPercent: 100,
        activeProbeCount: 0,
        totalProbeCount: 0,
        lasers: [],
        revealedIssues: [],
        totalIssues: 0,
      }));
      return;
    }

    flushSync(() => {
      setState({
        phase: 'scanning',
        plan: null,
        segmentById: plan.segmentById,
        progressPercent: 0,
        activeProbeCount: activeTaskIndicesRef.current.length,
        totalProbeCount: plan.tasks.length,
        maxConcurrentProbes: MAX_CONCURRENT_PROBES,
        lasers: buildLaserVisuals(plan.tasks, runtimeRef.current),
        discoveringTrackId: null,
        activeIssue: null,
        highlightTrackIds: [],
        flashing: false,
        revealedIssues: [],
        totalIssues: 0,
      });
    });

    scanningRef.current = true;
    lastFrameTsRef.current = 0;
    requestAnimationFrame(() => {
      scheduleStep();
    });
  }, [areas, buildLaserVisuals, resetPool, scheduleStep, stopScanningLoop]);

  const continueScan = useCallback(() => {
    const ti = activeTaskIndexRef.current;
    const tasks = tasksRef.current;
    const runtime = runtimeRef.current;
    if (ti >= 0 && tasks[ti] && runtime[ti]) {
      const rt = runtime[ti]!;
      const prevPending = tasks[ti]!.pendingIssues[rt.issueIndex];
      rt.issueIndex += 1;
      const resumeFrom = (prevPending?.revealDistancePx ?? rt.distancePx) + 1;
      rt.distancePx = resumeFrom;
      rt.prevDistancePx = resumeFrom - 1;
    }
    activeTaskIndexRef.current = -1;

    flushSync(() => {
      setState((s) => ({
        ...s,
        phase: 'scanning',
        activeIssue: null,
        highlightTrackIds: [],
        discoveringTrackId: null,
        flashing: false,
        lasers: buildLaserVisuals(tasks, runtime),
      }));
    });

    scanningRef.current = true;
    lastFrameTsRef.current = 0;
    requestAnimationFrame(() => {
      scheduleStep();
    });
  }, [buildLaserVisuals, scheduleStep]);

  useEffect(
    () => () => {
      stopScanningLoop();
    },
    [stopScanningLoop],
  );

  return {
    state,
    startScan,
    continueScan,
    stopScan,
    resetScan,
  };
}

function fieldPointCovered(
  point: ScanPathPoint,
  plan: ParallelScanPlan,
): boolean {
  const seg = plan.segmentById.get(point.trackId);
  if (!seg) return true;
  const b = seg.bounds;
  return (
    point.xM >= b.xMinM &&
    point.xM <= b.xMaxM &&
    point.yM >= b.yMinM &&
    point.yM <= b.yMaxM
  );
}
