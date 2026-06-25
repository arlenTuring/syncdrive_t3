export function newVehicleId(prefix = 'v'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function newRuleId(): string {
  return `r${Math.random().toString(36).slice(2, 9)}`;
}
