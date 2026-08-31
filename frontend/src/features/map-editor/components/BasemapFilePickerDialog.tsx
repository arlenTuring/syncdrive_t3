import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FileCode2, Image, Upload } from 'lucide-react'
import type { BasemapFileSelection } from '../utils/basemapFacility'
import { parseOpenDriveXodr, laneFillColor, lanePolygonToSvgPath, laneStrokeColor } from '../opendrive'

type Props = {
  open: boolean
  initialFileName?: string | null
  onConfirm: (selection: BasemapFileSelection) => void
  onCancel: () => void
}

const ACCEPT = 'image/*,.xodr,application/xml,text/xml'

function isXodrFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.xodr') || name.endsWith('.xml')
}

export function BasemapFilePickerDialog({
  open,
  initialFileName,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [xodrContent, setXodrContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const xodrPreview = useMemo(() => {
    if (!xodrContent) return null
    try {
      return parseOpenDriveXodr(xodrContent, { sampleStepM: 2 })
    } catch {
      return null
    }
  }, [xodrContent])

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }

  useEffect(() => {
    if (!open) {
      revokePreview()
      setSelectedFile(null)
      setPreviewUrl(null)
      setXodrContent(null)
      setError(null)
      setDragOver(false)
      return
    }
    revokePreview()
    setSelectedFile(null)
    setPreviewUrl(null)
    setXodrContent(null)
    setError(null)
    setDragOver(false)
  }, [open])

  useEffect(() => () => revokePreview(), [])

  if (!open) return null

  const applyFile = async (file: File | null | undefined) => {
    if (!file) return
    revokePreview()
    setPreviewUrl(null)
    setXodrContent(null)
    setSelectedFile(file)
    setError(null)

    if (isXodrFile(file)) {
      try {
        const text = await file.text()
        parseOpenDriveXodr(text, { sampleStepM: 2 })
        setXodrContent(text)
      } catch (err) {
        setSelectedFile(null)
        setError(err instanceof Error ? err.message : 'OpenDRIVE 檔案無法解析')
      }
      return
    }

    if (!file.type.startsWith('image/')) {
      setSelectedFile(null)
      setError('請選擇圖片或 .xodr 檔案')
      return
    }

    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }

  const submit = () => {
    if (!selectedFile) {
      setError('請先選擇底圖檔案')
      return
    }
    if (xodrContent) {
      onConfirm({ kind: 'xodr', file: selectedFile, content: xodrContent })
      setSelectedFile(null)
      setXodrContent(null)
      return
    }
    if (!previewUrl) {
      setError('請先選擇底圖檔案')
      return
    }
    const url = previewUrl
    previewUrlRef.current = null
    setPreviewUrl(null)
    setSelectedFile(null)
    onConfirm({ kind: 'image', file: selectedFile, previewUrl: url })
  }

  const canSubmit = !!selectedFile && (!!previewUrl || !!xodrContent)

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-zinc-600 bg-zinc-900 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-100">
          載入底圖
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          支援本機圖片（PNG、JPG 等）或 OpenDRIVE（.xodr）即時繪製車道平面圖。可點擊選擇或拖曳檔案至下方區域。
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            void applyFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const next = e.relatedTarget as Node | null
            if (!next || !e.currentTarget.contains(next)) {
              setDragOver(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void applyFile(file)
          }}
          className={[
            'mt-4 flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-8 transition',
            dragOver
              ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100'
              : 'border-zinc-600 bg-zinc-950/60 text-zinc-400 hover:border-cyan-600/60 hover:bg-zinc-950 hover:text-zinc-200',
          ].join(' ')}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={selectedFile?.name ?? '預覽'}
              className="max-h-48 max-w-full rounded-md object-contain shadow-md"
            />
          ) : xodrPreview ? (
            <svg
              viewBox={`0 0 320 140`}
              className="h-40 w-full rounded-md bg-zinc-950 shadow-md"
              aria-hidden
            >
              {xodrPreview.lanes.map((lane) => (
                <path
                  key={`${lane.roadId}-${lane.laneId}-${lane.mmslLaneId ?? 'x'}`}
                  d={lanePolygonToSvgPath(lane.points, xodrPreview.bounds, 320, 140)}
                  fill={laneFillColor(lane.laneType)}
                  stroke={laneStrokeColor(lane.laneType)}
                  strokeWidth={0.6}
                />
              ))}
            </svg>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="size-8 text-zinc-500" aria-hidden />
              <div className="flex items-center gap-2 text-zinc-600">
                <Image className="size-5" aria-hidden />
                <FileCode2 className="size-5" aria-hidden />
              </div>
            </div>
          )}
          <span className="text-sm">
            {selectedFile?.name ??
              (initialFileName
                ? `目前：${initialFileName}`
                : dragOver
                  ? '放開以載入檔案'
                  : '點擊或拖曳圖片／.xodr 至此')}
          </span>
          {xodrPreview ? (
            <span className="text-xs text-zinc-500">
              {xodrPreview.roadCount} 條道路 · {xodrPreview.laneCount} 個車道區塊
            </span>
          ) : null}
        </button>

        {error ? (
          <p className="mt-2 text-sm text-rose-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md border border-cyan-700 bg-cyan-950/60 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            套用底圖
          </button>
        </div>
      </div>
    </div>
  )
}
