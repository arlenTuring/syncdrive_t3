import { useCallback, useState } from 'react';
import { addMembers, CANDIDATES_PAGE_SIZE, listCandidates, type MediaGroup } from './api';
import { MediaPickerDialog, type PickerPage } from './MediaPickerDialog';

/** 分組的「加入媒體」：共用媒體選擇器，確定時寫入分組（帶最新取得的分組版本） */
export function AddMediaDialog({ group, onClose, onAdded }: { group: MediaGroup; onClose: () => void; onAdded: (group: MediaGroup, count: number) => void }) {
  const [latest, setLatest] = useState({ version: group.version, memberCount: group.member_count, addMax: 30, memberMax: 100 });
  const load = useCallback(
    async (query: { keyword: string; page: number }, signal: AbortSignal): Promise<PickerPage> => {
      const page = await listCandidates({ groupId: group.id, keyword: query.keyword, page: query.page }, signal);
      setLatest({ version: page.group.version, memberCount: page.group.member_count, addMax: page.limits.add_max, memberMax: page.limits.member_max });
      return { items: page.items.map(({ in_group, ...item }) => ({ ...item, included: in_group })), total: page.total, pageSize: CANDIDATES_PAGE_SIZE };
    },
    [group.id],
  );
  const room = Math.max(0, latest.memberMax - latest.memberCount);
  return (
    <MediaPickerDialog
      load={load}
      onClose={onClose}
      targetLabel="分組"
      maxSelect={Math.min(latest.addMax, room)}
      limitHint={`單次最多 ${latest.addMax} 個；此分組最多 ${latest.memberMax} 個媒體，還可加入 ${room} 個。`}
      onConfirm={async (ids) => {
        const saved = await addMembers(group.id, ids, latest.version);
        onAdded(saved, ids.length);
      }}
    />
  );
}
