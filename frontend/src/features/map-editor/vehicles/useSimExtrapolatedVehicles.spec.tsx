// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AreaVehicleLive } from './types';

/**
 * 2026-10-30 車隊上線量測：模擬播放每一幀都替每台車產生新物件，停著的車也跟著整台重畫
 * （車輛圖層每次 commit 約 209 個元件）。位置沒變的車要沿用同一個物件；整幀沒變就回傳同一個陣列。
 */
const clock = vi.hoisted(() => ({ frame: 1, listeners: new Set<() => void>() }));
vi.mock('../../dashboard/utils/simClockFrame', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSimClockFrame: (enabled: boolean) =>
      useSyncExternalStore(
        (fn) => {
          if (!enabled) return () => {};
          clock.listeners.add(fn);
          return () => clock.listeners.delete(fn);
        },
        () => clock.frame,
      ),
  };
});

const { useSimExtrapolatedVehicles } = await import('./useSimExtrapolatedVehicles');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vehicle = (id: string, xM: number, simMs: number, extra: Record<string, unknown> = {}): AreaVehicleLive =>
  ({ vehicleId: id, areaId: 'A', xM, yM: 0, payload: { sim_elapsed_ms: simMs, trip_code: `T-${id}`, ...extra } }) as unknown as AreaVehicleLive;

let outputs: AreaVehicleLive[][] = [];
let root: Root | null = null;
function Probe({ vehicles }: { vehicles: AreaVehicleLive[] }) {
  const out = useSimExtrapolatedVehicles(vehicles, { active: true, speedMultiplier: 1 });
  useEffect(() => {
    outputs.push(out);
  });
  return null;
}
const render = (vehicles: AreaVehicleLive[]) =>
  act(async () => root!.render(createElement(Probe, { vehicles })));
const tick = () =>
  act(async () => {
    clock.frame += 1;
    for (const fn of clock.listeners) fn();
  });

beforeEach(() => {
  outputs = [];
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe('useSimExtrapolatedVehicles 輸出物件的穩定性', () => {
  it('停著（位置不再變）的車沿用同一個物件；整幀都沒變就回傳同一個陣列', async () => {
    // 每台車送滿 3 幀（播放緩衝），A 之後不再動，B 持續前進
    for (let i = 0; i < 3; i += 1) await render([vehicle('A', 10, 1000), vehicle('B', i * 5, 1000 + i * 1000)]);
    const settled = outputs.at(-1)!;
    await tick();
    await tick();
    const later = outputs.at(-1)!;
    expect(later[0]).toBe(settled[0]);
    // 來源與位置都沒變：整個陣列沿用，車輛圖層的 context 不變、不重畫
    expect(later).toBe(outputs.at(-2));
  });

  it('移動中的車位置變了就換新物件，停著的車仍是同一個', async () => {
    const a = vehicle('A', 10, 1000);
    await render([a, vehicle('B', 0, 1000)]);
    await render([a, vehicle('B', 5, 2000)]);
    await render([a, vehicle('B', 10, 3000)]);
    const before = outputs.at(-1)!;
    await render([a, vehicle('B', 15, 4000)]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500);
    await tick();
    const after = outputs.at(-1)!;
    vi.restoreAllMocks();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].xM).toBeGreaterThan(before[1].xM);
  });
});
