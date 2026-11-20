import { GripHorizontal, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { SiteSelect } from '../../components/SiteSelect';
import { ErrorLine } from '../media-groups/dialogs';
import { videoApi, type SourceOption, type Tab } from './api';
import { ASPECT_PRESETS, CANVAS, MIN_TILE, TILE_MAX, addTile, evenLayout, snapMove, snapRect, validLayout, validRect, type DraftTile, type Rect } from './layout';
import { Button, cn, Dialog, Field, TextInput } from '../../components/ui';
import { tokenVar } from '../../styles/tokens';

let keySeq = 0;
const nextKey = () => `draft-${(keySeq += 1)}`;

/**
 * 新增分頁／編輯版面（設計稿 2026-11-20）。這裡只顯示配置示意，不啟動任何播放器。
 *
 * - 新增時先填名稱、按「新增視窗」：第一個視窗滿版；之後分割選取的視窗（沒選就是最大的一個），其他視窗不動。
 * - 從視窗左上角的拖曳點移動，從邊或角拉伸大小；結束時對齊格線並吸附到畫布邊與其他視窗的邊。
 *   放開的位置不合法（越界、太小、重疊）就回到上一次合法的位置。
 * - 「均分版面」要使用者按下才會重新排列；取消不會寫入任何東西。
 */
export function LayoutEditorDialog({
  tab,
  options,
  onClose,
  onSaved,
}: {
  tab: Tab | null;
  options: SourceOption[];
  onClose: () => void;
  onSaved: (tab: Tab) => void;
}) {
  const [name, setName] = useState(tab?.name ?? '');
  const [aspect, setAspect] = useState(tab?.canvasAspectRatio ?? 16 / 9);
  const [tiles, setTiles] = useState<DraftTile[]>(() => (tab ? [...tab.tiles].sort((a, b) => a.position - b.position).map((t) => ({ key: t.id, tileId: t.id, sourceId: t.sourceId, x: t.x, y: t.y, w: t.w, h: t.h })) : []));
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 放開位置不合法時強制重畫，讓 Rnd 回到最後合法的位置
  const [nonce, setNonce] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(800);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const update = () => setAreaWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 畫布固定可用區：寬度依對話框、高度最多 58vh，依長寬比 fit
  const maxH = typeof window === 'undefined' ? 480 : Math.max(240, window.innerHeight * 0.58);
  const W = Math.max(200, Math.min(areaWidth, maxH * aspect));
  const H = W / aspect;
  const px = (v: number, total: number) => (v / CANVAS) * total;
  const norm = (v: number, total: number) => Math.round((v / total) * CANVAS);
  const sourceName = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(t);
  }, [notice]);

  const commit = (key: string, rect: Rect, mode: 'move' | 'resize') => {
    const others = tiles.filter((t) => t.key !== key);
    const snapped = mode === 'move' ? snapMove(rect, others) : snapRect(rect, others);
    if (!validRect(snapped, others)) {
      setNotice(snapped.w < MIN_TILE || snapped.h < MIN_TILE ? '視窗太小，已回到原位置' : '不能和其他視窗重疊或超出畫布，已回到原位置');
      setNonce((n) => n + 1);
      return;
    }
    setTiles((list) => list.map((t) => (t.key === key ? { ...t, ...snapped } : t)));
  };

  const add = () => {
    const next = addTile(tiles, selected, nextKey());
    if (!next) {
      setNotice(tiles.length >= TILE_MAX ? `每個分頁最多 ${TILE_MAX} 個視窗` : '選取的視窗太小，不能再分割；請先選較大的視窗或拉大它');
      return;
    }
    setTiles(next);
    setSelected(next[next.length - 1]?.key ?? null);
  };

  const remove = () => {
    if (!selected) return;
    setTiles((list) => list.filter((t) => t.key !== selected));
    setSelected(null);
  };

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('請輸入分頁名稱');
    if (!tiles.length) return setError('至少要有 1 個視窗；請按「新增視窗」');
    if (!validLayout(tiles)) return setError('版面有重疊或超出畫布的視窗，請調整後再儲存');
    setSaving(true);
    try {
      const rects = tiles.map((t) => ({ tileId: t.tileId, x: t.x, y: t.y, w: t.w, h: t.h }));
      const saved = tab
        ? await videoApi.saveLayout(tab.id, { expectedVersion: tab.version, name: name.trim(), canvasAspectRatio: aspect, tiles: rects })
        : await videoApi.createTab({ name: name.trim(), canvasAspectRatio: aspect, tiles: rects });
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };

  const aspectOptions = ASPECT_PRESETS.some((p) => Math.abs(p.value - aspect) < 0.001) ? ASPECT_PRESETS : [...ASPECT_PRESETS, { value: aspect, label: `目前 ${aspect.toFixed(2)}:1` }];

  const ready = Boolean(name.trim()) && tiles.length > 0;

  return (
    <Dialog
      title={tab ? '編輯版面' : '新增分頁'}
      widthClassName="max-w-2xl"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button hierarchy="subordinate" variant="standard" onPress={onClose} disabled={saving}>取消</Button>
          <Button onPress={() => void save()} disabled={saving || !ready}>{saving ? '儲存中…' : tab ? '儲存' : '新增'}</Button>
        </>
      }
    >
      <div className="grid gap-3 border-b border-border-quaternary pb-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="分頁名稱" required>
          {(id) => <TextInput id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="請輸入" />}
        </Field>
        <Field label="畫面比例">
          {(id) => (
            <SiteSelect
              id={id}
              aria-label="畫面比例"
              value={String(aspect)}
              options={aspectOptions.map((p) => ({ value: String(p.value), label: p.label }))}
              onChange={(e) => setAspect(Number(e.target.value))}
              size="md"
              className="w-full"
            />
          )}
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onPress={add}
          disabled={tiles.length >= TILE_MAX}
          leadingIcon={<Plus />}
          title={`${selected ? '分割選取的視窗' : '沒有選取時分割最大的一個視窗'}（${tiles.length} / ${TILE_MAX}）`}
        >
          新增視窗
        </Button>
        <Button hierarchy="subordinate" variant="tonal" onPress={() => setTiles((list) => evenLayout(list, aspect))} disabled={tiles.length < 2} leadingIcon={<LayoutGrid />}>均分版面</Button>
        <Button hierarchy="danger" variant="standard" onPress={remove} disabled={!selected} leadingIcon={<Trash2 />} title="刪除選取的視窗（不會刪來源或停止錄影）">刪除</Button>
      </div>
      <div ref={areaRef} className="mt-4 flex w-full justify-center">
        <div
          className="relative border border-dashed border-border-theme-light bg-surface-sub-background"
          style={{ width: W, height: H }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          {tiles.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-body-m text-text-secondary">尚未新增視窗</div>
          ) : null}
          {tiles.map((t, index) => {
            const src = t.sourceId ? sourceName.get(t.sourceId) : undefined;
            const isSel = selected === t.key;
            return (
              <Rnd
                key={`${t.key}-${nonce}`}
                bounds="parent"
                position={{ x: px(t.x, W), y: px(t.y, H) }}
                size={{ width: px(t.w, W), height: px(t.h, H) }}
                minWidth={px(MIN_TILE, W)}
                minHeight={px(MIN_TILE, H)}
                dragHandleClassName="layout-tile-handle"
                onDragStart={() => setSelected(t.key)}
                onResizeStart={() => setSelected(t.key)}
                onDragStop={(_e, d) => commit(t.key, { x: norm(d.x, W), y: norm(d.y, H), w: t.w, h: t.h }, 'move')}
                onResizeStop={(_e, _dir, ref, _delta, pos) => commit(t.key, { x: norm(pos.x, W), y: norm(pos.y, H), w: norm(ref.offsetWidth, W), h: norm(ref.offsetHeight, H) }, 'resize')}
                className="p-0.5"
                resizeHandleStyles={isSel ? { bottomRight: { width: 10, height: 10, right: -5, bottom: -5, background: tokenVar('link-theme-filled'), borderRadius: 999 } } : undefined}
              >
                <div
                  onPointerDown={() => setSelected(t.key)}
                  aria-label={`視窗 ${index + 1}`}
                  className={cn('relative h-full w-full overflow-hidden rounded border', isSel ? 'border-border-theme bg-surface-theme' : 'border-border-tertiary bg-surface-sub-background')}
                >
                  <div className="layout-tile-handle absolute left-0 top-0 flex size-7 cursor-move items-center justify-center" title="拖曳移動">
                    <GripHorizontal className={cn('size-4', isSel ? 'text-text-theme' : 'text-text-primary')} aria-hidden />
                  </div>
                  <div className={cn('flex h-full items-center justify-center px-6 text-center text-body-m', isSel ? 'text-text-theme' : 'text-text-primary')}>
                    <span className="truncate">{src ? src.name : t.sourceId ? '來源已刪除' : '未指派來源'}</span>
                  </div>
                </div>
              </Rnd>
            );
          })}
        </div>
      </div>
      {notice ? <p className="mt-2 text-center text-body-xs text-status-warning" role="status">{notice}</p> : null}
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
