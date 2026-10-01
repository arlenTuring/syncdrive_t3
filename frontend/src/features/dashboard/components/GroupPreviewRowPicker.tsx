import type { GroupPreviewRowsState } from '../elements/GroupPreviewRowsProbe';

/**
 * 子畫布／樣板編輯時，畫布上用的是群組哪一列真實資料。
 *
 * 只列真實列；沒有資料就直接說沒有資料，畫布上的欄位會顯示成 {欄位名}。
 */
function describeRow(row: Record<string, unknown>): string {
  const parts = [row.vehicle_code, row.trip_code ?? row.maint_type_label, row.shift_key ?? row.order_id]
    .map((value) => (value === null || value === undefined ? '' : String(value).trim()))
    .filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

export function GroupPreviewRowPicker({
  state,
  rowIndex,
  onChangeRowIndex,
}: {
  state: GroupPreviewRowsState;
  rowIndex: number;
  onChangeRowIndex: (index: number) => void;
}) {
  if (state.error) {
    return <span className={`text-xs ${state.stale ? 'text-amber-400' : 'text-red-400'}`}>
      {state.stale ? `預覽資料：本次更新失敗，顯示上次成功資料（${state.error}）` : `預覽資料：載入失敗（${state.error}）`}
    </span>;
  }
  if (state.rows.length === 0) {
    return (
      <span className="text-xs text-amber-400" title="畫布上的欄位顯示 {欄位名}，代表這個群組目前沒有資料可以填入">
        {state.loading ? '預覽資料：載入中…' : '預覽資料：目前沒有資料，欄位顯示 {欄位名}'}
      </span>
    );
  }
  const safeIndex = Math.min(rowIndex, state.rows.length - 1);
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
      預覽資料
      <select
        value={safeIndex}
        onChange={(e) => onChangeRowIndex(Number(e.target.value))}
        className="text-xs bg-zinc-800 border border-emerald-500/40 text-emerald-300 rounded-md px-2 py-1"
        title="畫布上顯示的是這一列的真實資料（跟執行畫面同一條資料管線）"
      >
        {state.rows.map((row, index) => (
          <option key={index} value={index}>
            第 {index + 1}／{state.rows.length} 筆{describeRow(row) ? `：${describeRow(row)}` : ''}
          </option>
        ))}
      </select>
      {state.unplacedCount > 0 && <span className="text-amber-400">含 {state.unplacedCount} 筆目前未排入大屏</span>}
    </label>
  );
}
