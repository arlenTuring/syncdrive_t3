/** 依格數決定欄數：1 格一欄、2–4 格兩欄、5–9 格三欄、10–12 格四欄；窄視窗依斷點減少 */
export function gridColumns(count: number) {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 9) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

