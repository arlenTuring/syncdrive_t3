import { useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, Image, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BasemapFileSelection } from '../utils/basemapFacility'
import { parseOpenDriveXodr, laneFillColor, lanePolygonToSvgPath, laneStrokeColor } from '../opendrive'
import { Button, Dialog } from '../../../components/ui';

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
  const { t } = useTranslation()
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
        setError(err instanceof Error ? err.message : t('mapEditor.basemap.parseFailed'))
      }
      return
    }

    if (!file.type.startsWith('image/')) {
      setSelectedFile(null)
      setError(t('mapEditor.basemap.selectImageOrXodr'))
      return
    }

    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }

  const submit = () => {
    if (!selectedFile) {
      setError(t('mapEditor.basemap.selectFirst'))
      return
    }
    if (xodrContent) {
      onConfirm({ kind: 'xodr', file: selectedFile, content: xodrContent })
      setSelectedFile(null)
      setXodrContent(null)
      return
    }
    if (!previewUrl) {
      setError(t('mapEditor.basemap.selectFirst'))
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
    <Dialog padded={false} title={t('mapEditor.basemap.title')} onClose={() => onCancel()} widthClassName="w-full max-w-lg">
<div className="px-6 pb-5 flex min-h-0 flex-1 flex-col overflow-auto">
        <p className="mt-2 text-body-s text-text-tertiary">
          {t('mapEditor.basemap.hint')}
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
              ? 'border-border-theme bg-surface-theme text-text-theme-light'
              : 'border-border-tertiary bg-black-30 text-text-tertiary hover:border-border-theme-light hover:bg-surface-sub-background hover:text-text-primary',
          ].join(' ')}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={selectedFile?.name ?? t('mapEditor.basemap.previewAlt')}
              className="max-h-48 max-w-full rounded-md object-contain shadow-md"
            />
          ) : xodrPreview ? (
            <svg
              viewBox={`0 0 320 140`}
              className="h-40 w-full rounded-md bg-surface-sub-background shadow-md"
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
              <Upload className="size-8 text-text-quaternary" aria-hidden />
              <div className="flex items-center gap-2 text-text-disabled">
                <Image className="size-5" aria-hidden />
                <FileCode2 className="size-5" aria-hidden />
              </div>
            </div>
          )}
          <span className="text-body-s">
            {selectedFile?.name ??
              (initialFileName
                ? t('mapEditor.basemap.currentFile', { name: initialFileName })
                : dragOver
                  ? t('mapEditor.basemap.dropToLoad')
                  : t('mapEditor.basemap.clickOrDrag'))}
          </span>
          {xodrPreview ? (
            <span className="text-body-xs text-text-quaternary">
              {t('mapEditor.basemap.roadsLanes', {
                roads: xodrPreview.roadCount,
                lanes: xodrPreview.laneCount,
              })}
            </span>
          ) : null}
        </button>

        {error ? (
          <p className="mt-2 text-body-s text-status-error-emphasis" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="subordinate" variant="outlined" onPress={submit} disabled={!canSubmit}>{t('mapEditor.basemap.apply')}</Button>
        </div>
      </div>
</Dialog>
  )
}
