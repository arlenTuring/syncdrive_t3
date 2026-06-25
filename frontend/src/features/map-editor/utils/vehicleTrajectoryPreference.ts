const PREFIX = 'syncdrive-vehicle-traj-entry:'

export function getStoredTrajectoryEntryId(
  vehicleId: string,
): string | null {
  try {
    const v = localStorage.getItem(`${PREFIX}${vehicleId}`)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function setStoredTrajectoryEntryId(
  vehicleId: string,
  entryId: string,
): void {
  try {
    localStorage.setItem(`${PREFIX}${vehicleId}`, entryId)
  } catch {
    /* ignore */
  }
}

export function clearStoredTrajectoryEntryId(vehicleId: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${vehicleId}`)
  } catch {
    /* ignore */
  }
}
