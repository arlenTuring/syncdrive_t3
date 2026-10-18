import { MediaLibraryItem, MediaLibraryKind } from '../database/entities/media-library-item.entity';
import type { MediaType, StoredMediaFile } from './media-storage.service';

export type MediaBody = {
  mediaType?: MediaType;
  description?: string;
  textContent?: string;
  file?: StoredMediaFile;
  mediaIds?: string[];
  unavailableReason?: string;
};

export type MediaUnavailableReason = 'missing_type' | 'empty_text' | 'missing_file' | 'file_not_ready';

export const UNAVAILABLE_LABEL: Record<MediaUnavailableReason, string> = {
  missing_type: '未設定檔案類型',
  empty_text: '文字內容為空',
  missing_file: '缺少檔案',
  file_not_ready: '檔案處理未完成或失敗',
};

/**
 * 單一媒體能不能播放（依保存的內容判定，不讀實體檔）：
 * 文字要有有效文字；其他類型要有已處理完成的檔案。
 */
export function mediaUnavailableReason(row: Pick<MediaLibraryItem, 'kind' | 'body'>): MediaUnavailableReason | null {
  const body = row.body as MediaBody;
  if (!body.mediaType) return 'missing_type';
  if (body.mediaType === 'text') return body.textContent?.trim() ? null : 'empty_text';
  if (!body.file?.storageKey) return 'missing_file';
  if (body.file.status !== 'ready') return 'file_not_ready';
  return null;
}

export function groupMediaIds(row: Pick<MediaLibraryItem, 'body'>): string[] {
  const ids = (row.body as MediaBody).mediaIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** 成員摘要：名稱、類型、內容描述、文字摘要或原始檔名；不帶檔案內容 */
export function memberSummary(row: MediaLibraryItem) {
  const body = row.body as MediaBody;
  const reason = mediaUnavailableReason(row);
  const text = body.textContent?.trim() ?? '';
  return {
    id: row.id,
    name: row.name,
    media_type: body.mediaType ?? null,
    description: body.description ?? '',
    text_excerpt: body.mediaType === 'text' ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : null,
    original_name: body.file?.originalName ?? null,
    available: reason === null,
    unavailable_reason: reason,
    unavailable_label: reason ? UNAVAILABLE_LABEL[reason] : null,
    updated_at: row.updatedAt,
  };
}

export type MemberSummary = ReturnType<typeof memberSummary>;

/** 分組能不能播放：至少一個成員、每個成員都存在且可播放 */
export function groupPlayability(memberIds: string[], members: Map<string, MediaLibraryItem>) {
  const missing = memberIds.filter((id) => !members.has(id) || members.get(id)!.kind !== MediaLibraryKind.MEDIA);
  const unavailable = memberIds.filter((id) => members.has(id) && mediaUnavailableReason(members.get(id)!) !== null);
  const reason = memberIds.length === 0 ? 'empty' : missing.length ? 'missing_member' : unavailable.length ? 'member_unavailable' : null;
  return {
    playable: reason === null,
    reason,
    label: reason === 'empty' ? '空分組' : reason === 'missing_member' ? `有 ${missing.length} 個成員已不存在` : reason === 'member_unavailable' ? `有 ${unavailable.length} 個成員無法播放` : null,
    missing_ids: missing,
  };
}
