import { GripHorizontal, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { SiteSelect } from '../../components/SiteSelect';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { videoApi, type SourceOption, type Tab } from './api';
import { ASPECT_PRESETS, CANVAS, MIN_TILE, TILE_MAX, addTile, evenLayout, snapMove, snapRect, validLayout, validRect, type DraftTile, type Rect } from './layout';
import { Button, fieldClass } from '../../components/ui';
import { tokenVar } from '../../styles/tokens';

const field = fieldClass({ size: 'md' });
/** 版面編輯畫布的格線 */
const GRID_LINE = tokenVar('border-disabled');
let keySeq = 0;
const nextKey = () => `draft-${(keySeq += 1)}`;

/**
 * 新增／編輯監控版面。這裡只顯示配置示意，不啟動任何播放器。
 *
 * - 新增時先填名稱、按「加入影像格」：第一格滿版；之後分割選取的格子（沒選就是最大的一格），其他格子不動。
 * - 從格子標題列拖曳移動，從邊或角拉伸大小；結束時對齊格線並吸附到畫布邊與其他格子的邊。
 *   放開的位置不合法（越界、太小、重疊）就回到上一次合法的位置。
 * - 「平均重排」要使用者按下才會重新排列；取消不會寫入任何東西。
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
      setNotice(snapped.w < MIN_TILE || snapped.h < MIN_TILE ? '格子太小，已回到原位置' : '不能和其他格子重疊或超出畫布，已回到原位置');
      setNonce((n) => n + 1);
      return;
    }
    setTiles((list) => list.map((t) => (t.key === key ? { ...t, ...snapped } : t)));
  };

  const add = () => {
    const next = addTile(tiles, selected, nextKey());
    if (!next) {
      setNotice(tiles.length >= TILE_MAX ? `每個標籤頁最多 ${TILE_MAX} 格` : '選取的格子太小，不能再分割；請先選較大的格子或拉大它');
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
    if (!name.trim()) return setError('請輸入標籤頁名稱');
    if (!tiles.length) return setError('至少要有 1 格；請按「加入影像格」');
    if (!validLayout(tiles)) return setError('版面有重疊或超出畫布的格子，請調整後再儲存');
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

  return (
    <Dialog
      title={tab ? `編輯版面：${tab.name}` : '新增監控標籤頁'}
      width="max-w-5xl"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <span className="mr-auto text-body-xs text-text-quaternary">{tiles.length} / {TILE_MAX} 格・刪除格子不會刪來源或停止錄影</span>
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>{saving ? '儲存中…' : '儲存版面'}</PrimaryButton>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="flex flex-col gap-1">
          <span className="text-body-xs text-text-tertiary">標籤頁名稱</span>
          <input className={field} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="例如：北側月台" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-xs text-text-tertiary">畫布比例</span>
          <SiteSelect
            aria-label="畫布比例"
            value={String(aspect)}
            options={aspectOptions.map((p) => ({ value: String(p.value), label: p.label }))}
            onChange={(e) => setAspect(Number(e.target.value))}
            size="md"
            className="w-full"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onPress={add} disabled={tiles.length >= TILE_MAX} leadingIcon={<Plus />}>加入影像格</Button>
        <Button hierarchy="subordinate" variant="outlined" onPress={() => setTiles((list) => evenLayout(list, aspect))} disabled={tiles.length < 2} leadingIcon={<LayoutGrid />}>平均重排</Button>
        <Button hierarchy="danger" variant="outlined" onPress={remove} disabled={!selected} leadingIcon={<Trash2 />}>刪除選取格</Button>
        <span className="text-body-xs text-text-quaternary">{selected ? '新增會分割選取的格子' : '沒有選取時，新增會分割最大的一格'}・拖曳標題列移動，拉邊或角調整大小</span>
      </div>
      <div ref={areaRef} className="mt-3 flex w-full justify-center">
        <div
          className="relative rounded-lg border border-dashed border-border-tertiary bg-surface-sub-background"
          style={{ width: W, height: H, backgroundImage: `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`, backgroundSize: `${W / 10}px ${H / 10}px` }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          {tiles.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-body-s text-text-quaternary">按「加入影像格」建立第一格（會占滿畫布）</div>
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
                resizeHandleStyles={isSel ? { bottomRight: { width: 12, height: 12, right: -4, bottom: -4, background: tokenVar('link-theme-filled'), borderRadius: 999, border: `2px solid ${tokenVar('color-white-100')}` } } : undefined}
              >
                <div
                  onPointerDown={() => setSelected(t.key)}
                  className={`flex h-full w-full flex-col overflow-hidden rounded-md border text-body-xs ${isSel ? 'border-border-theme bg-surface-theme' : 'border-border-tertiary bg-surface-primary'}`}
                >
                  <div className="layout-tile-handle flex h-7 shrink-0 cursor-move items-center gap-1.5 bg-black-30 px-2 text-text-primary">
                    <GripHorizontal className="size-3.5 shrink-0 text-text-quaternary" aria-hidden />
                    <span className="truncate">第 {index + 1} 格</span>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center px-2 text-center text-text-tertiary">
                    <span className="truncate">{src ? src.name : t.sourceId ? '來源已刪除' : '尚未選來源'}</span>
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
