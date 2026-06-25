/** 軌跡點時間顯示（本地時區） */
export function formatTrajectoryPointTime(tMs: number): string {
  try {
    return new Date(tMs).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
    })
  } catch {
    return String(tMs)
  }
}
