import { createContext, useContext } from 'react';

/** 模擬播放狀態（地圖／軌道動畫用，與 3s poll 的 loading/error 分離） */
export type DemoSimulationPlayback = {
  running: boolean;
  paused: boolean;
  transportPaused: boolean;
  speedMultiplier: number;
};

const defaultPlayback: DemoSimulationPlayback = {
  running: false,
  paused: true,
  transportPaused: false,
  speedMultiplier: 1,
};

const DemoSimulationPlaybackContext = createContext<DemoSimulationPlayback>(defaultPlayback);
const DemoSimulationLiveContext = createContext(0);

export function DemoSimulationPlaybackProvider({
  value,
  children,
}: {
  value: DemoSimulationPlayback;
  children: React.ReactNode;
}) {
  return (
    <DemoSimulationPlaybackContext.Provider value={value}>
      {children}
    </DemoSimulationPlaybackContext.Provider>
  );
}

export function DemoSimulationLiveProvider({
  liveClearEpoch,
  children,
}: {
  liveClearEpoch: number;
  children: React.ReactNode;
}) {
  return (
    <DemoSimulationLiveContext.Provider value={liveClearEpoch}>
      {children}
    </DemoSimulationLiveContext.Provider>
  );
}

export function useDemoSimulationPlayback(): DemoSimulationPlayback {
  return useContext(DemoSimulationPlaybackContext);
}

export function useDemoSimulationPaused(): boolean {
  return useContext(DemoSimulationPlaybackContext).paused;
}

export function useDemoSimulationLiveClearEpoch(): number {
  return useContext(DemoSimulationLiveContext);
}
