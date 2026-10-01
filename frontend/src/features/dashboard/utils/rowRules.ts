/** Runtime-only metadata: a symbol cannot collide with user columns and JSON/export omit it. */
export const ROW_SOURCE_METADATA = Symbol('dashboard-row-source');

export interface RowSourceMetadata {
  sourceId: string;
  sourceLabel?: string;
  postProcessId?: string;
}

type RowWithSourceMetadata = Record<string, unknown> & {
  [ROW_SOURCE_METADATA]?: RowSourceMetadata;
};

export function withRowSourceMetadata(
  row: Record<string, unknown>,
  metadata: RowSourceMetadata,
): Record<string, unknown> {
  return Object.assign({}, row, { [ROW_SOURCE_METADATA]: metadata });
}

export function getRowSourceMetadata(row: Record<string, unknown> | null | undefined): RowSourceMetadata | undefined {
  return row ? (row as RowWithSourceMetadata)[ROW_SOURCE_METADATA] : undefined;
}
