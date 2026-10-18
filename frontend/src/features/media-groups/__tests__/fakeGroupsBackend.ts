/**
 * 測試用的記憶體內媒體分組後端：照真正 API 的規則驗證版本、成員、名稱與引用。只在測試裡用。
 */
type Media = { id: string; name: string; media_type: 'audio' | 'text' | 'image' | 'video'; description: string; available: boolean };
type Group = { id: string; name: string; version: number; mediaIds: string[] };

export function createFakeGroupsBackend(input: { media: Media[]; groups?: Group[]; references?: Record<string, string[]>; failNextReorder?: boolean }) {
  const media = new Map(input.media.map((item) => [item.id, item]));
  const groups = new Map((input.groups ?? []).map((group) => [group.id, { ...group }]));
  const calls: string[] = [];
  let failReorder = input.failNextReorder ?? false;
  let seq = 0;

  const summary = (id: string) => {
    const item = media.get(id);
    return item
      ? { ...item, text_excerpt: null, original_name: `${item.id}.bin`, unavailable_reason: item.available ? null : 'missing_file', unavailable_label: item.available ? null : '缺少檔案', missing: false }
      : { id, name: null, media_type: null, description: '', text_excerpt: null, original_name: null, available: false, unavailable_reason: 'missing', unavailable_label: '媒體已不存在', missing: true };
  };
  const present = (group: Group) => ({
    id: group.id,
    name: group.name,
    version: group.version,
    updated_at: String(group.version),
    member_count: group.mediaIds.length,
    members: group.mediaIds.map(summary),
    playable: group.mediaIds.length > 0,
    unavailable_reason: group.mediaIds.length ? null : 'empty',
    unavailable_label: group.mediaIds.length ? null : '空分組',
  });
  const fail = (status: number, message: string) => ({ status, body: { message } });
  const ok = (body: unknown) => ({ status: 200, body });

  const handle = (method: string, url: URL, body: Record<string, unknown>) => {
    const path = url.pathname.replace('/syncdrive-api/media-groups', '');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const versionOk = (group: Group, version: unknown) => Number(version) === group.version;
    if (method === 'GET' && parts.length === 0) {
      const keyword = url.searchParams.get('keyword') ?? '';
      const size = Number(url.searchParams.get('page_size'));
      const page = Number(url.searchParams.get('page'));
      const all = [...groups.values()].filter((group) => group.name.includes(keyword)).sort((a, b) => a.name.localeCompare(b.name) * (url.searchParams.get('sort_direction') === 'desc' ? -1 : 1));
      return ok({ items: all.slice((page - 1) * size, page * size).map(present), total: all.length, page, page_size: size });
    }
    if (method === 'GET' && parts[0] === 'candidates') {
      const group = groups.get(url.searchParams.get('group_id') ?? '')!;
      const keyword = url.searchParams.get('keyword') ?? '';
      const size = Number(url.searchParams.get('page_size'));
      const page = Number(url.searchParams.get('page'));
      const all = [...media.values()].filter((item) => item.name.includes(keyword));
      return ok({ group: { id: group.id, version: group.version, member_count: group.mediaIds.length }, items: all.slice((page - 1) * size, page * size).map((item) => ({ ...summary(item.id), in_group: group.mediaIds.includes(item.id) })), total: all.length, page, page_size: size, limits: { member_max: 100, add_max: 30 } });
    }
    if (method === 'POST' && parts.length === 0) {
      const name = String(body.name ?? '').trim();
      if ([...groups.values()].some((group) => group.name === name)) return fail(409, '已有相同名稱的分組');
      const group = { id: `MGR-${++seq}`, name, version: 1, mediaIds: [] };
      groups.set(group.id, group);
      return ok(present(group));
    }
    const group = groups.get(parts[0]);
    if (!group) return fail(404, '找不到媒體分組');
    if (method === 'GET' && parts[1] === 'delete-impact') {
      const refs = input.references?.[group.id] ?? [];
      return ok({ id: group.id, name: group.name, version: group.version, member_count: group.mediaIds.length, references: refs.map((name) => ({ kind: 'schedule', kind_label: '媒體排程', id: name, name })), allowed: refs.length === 0 });
    }
    if (method === 'GET') return ok(present(group));
    if (method === 'PATCH') {
      if (!versionOk(group, body.expected_version)) return fail(409, '分組已被其他使用者修改');
      group.name = String(body.name).trim();
      group.version += 1;
      return ok(present(group));
    }
    if (method === 'POST' && parts[1] === 'members') {
      if (!versionOk(group, body.expected_version)) return fail(409, '分組已被其他使用者修改');
      const ids = body.media_ids as string[];
      if (ids.some((id) => !media.get(id)?.available || group.mediaIds.includes(id))) return fail(400, '無法加入');
      group.mediaIds = [...group.mediaIds, ...ids];
      group.version += 1;
      return ok(present(group));
    }
    if (method === 'PUT') {
      if (failReorder) {
        failReorder = false;
        return fail(500, '資料庫暫時無法寫入');
      }
      if (!versionOk(group, body.expected_version)) return fail(409, '分組已被其他使用者修改');
      group.mediaIds = body.media_ids as string[];
      group.version += 1;
      return ok(present(group));
    }
    if (method === 'DELETE' && parts[1] === 'members') {
      if (!versionOk(group, url.searchParams.get('expected_version'))) return fail(409, '分組已被其他使用者修改');
      group.mediaIds = group.mediaIds.filter((id) => id !== parts[2]);
      group.version += 1;
      return ok(present(group));
    }
    if (method === 'DELETE') {
      if (input.references?.[group.id]?.length) return fail(409, '分組仍被引用');
      groups.delete(group.id);
      return ok({ deleted: true });
    }
    return fail(404, 'not found');
  };

  const fetch = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource), 'http://test.local');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${method} ${url.pathname}${url.search}${init?.body ? ' ' + String(init.body) : ''}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const result = handle(method, url, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;

  return { fetch, calls, groups, media, failNextReorder: () => (failReorder = true) };
}
