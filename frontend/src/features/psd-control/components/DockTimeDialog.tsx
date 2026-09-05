import { Lightbulb, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveDwellConflict, type DwellConflict } from '../resolveDwellConflict';
import { fetchVehicleStopDwellSeconds } from '../fetchVehicleStopDwell';

const MIN_SECONDS = 10;

function ConfirmVerifyDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const phrase = t('psdControl.dock.confirmPhrase');
  const [text, setText] = useState('');
  const ok = text.trim() === phrase;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-[480px] rounded-xl bg-[#27272a] px-6 pb-5 pt-5 text-zinc-100 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-medium">{t('psdControl.dock.dualVerify')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-0.5 text-zinc-300 hover:text-white"
            aria-label={t('common.close')}
          >
            <X className="size-5 stroke-[1.75]" />
          </button>
        </div>
        <div className="mb-8 rounded-lg bg-[#3f3f46]/50 px-4 py-4">
          <p className="mb-3 text-[14px] text-zinc-100">{t('psdControl.dock.confirmAndSave')}</p>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('psdControl.dock.confirmPlaceholder', { phrase })}
            className="h-11 w-full rounded-md border border-zinc-600 bg-[#18181b] px-3 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF]"
          />
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} className="text-[14px] text-zinc-100 hover:text-white">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={onSave}
            className={`rounded-lg px-5 py-2 text-[14px] ${
              ok ? 'bg-[#2B7FFF] text-white hover:bg-[#1d6feb]' : 'cursor-not-allowed bg-zinc-700 text-zinc-400'
            }`}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DockTimeDialog({
  vehicleCode,
  onClose,
  onApply,
}: {
  vehicleCode: string;
  onClose: () => void;
  onApply: (next: number) => void;
}) {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<number | null>(null);
  const [value, setValue] = useState(32);
  const [maxSeconds, setMaxSeconds] = useState(90);
  const [conflict, setConflict] = useState<DwellConflict | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<'edit' | 'verify'>('edit');

  useEffect(() => {
    let cancelled = false;
    void fetchVehicleStopDwellSeconds(vehicleCode)
      .then((result) => {
        if (cancelled) return;
        const seconds = result.seconds;
        if (seconds == null) {
          setLoadError(t('psdControl.dock.notFound'));
          setLoaded(true);
          return;
        }
        const max = Math.max(90, seconds, 180);
        setMaxSeconds(max);
        setInitial(seconds);
        setValue(seconds);
        setConflict(resolveDwellConflict(result.conflictTripItems));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(t('psdControl.dock.loadFailed'));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleCode, t]);

  const dirty = initial != null && value !== initial;
  const showWarning = dirty && loaded && conflict != null;
  const pct = ((value - MIN_SECONDS) / Math.max(1, maxSeconds - MIN_SECONDS)) * 100;

  const warningText = useMemo(() => {
    if (!conflict) return '';
    return t('psdControl.dock.warning', {
      window: conflict.windowLabel,
      tripCode: conflict.tripCode,
    });
  }, [conflict, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-[560px] rounded-xl bg-[#27272a] px-6 pb-5 pt-5 text-zinc-100 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-medium">{t('psdControl.dock.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-0.5 text-zinc-300 hover:text-white"
            aria-label={t('common.close')}
          >
            <X className="size-5 stroke-[1.75]" />
          </button>
        </div>

        <p className="mb-8 flex items-start gap-2 text-[13px] leading-relaxed text-zinc-400">
          <Lightbulb className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-zinc-400" aria-hidden />
          {t('psdControl.dock.hint')}
        </p>

        {!loaded ? (
          <p className="mb-8 text-[13px] text-zinc-400">{t('psdControl.dock.loading')}</p>
        ) : loadError || initial == null ? (
          <p className="mb-8 text-[13px] text-red-400">{loadError ?? t('psdControl.dock.noData')}</p>
        ) : (
          <div className="mb-6 flex items-center gap-4">
            <input
              type="range"
              min={MIN_SECONDS}
              max={maxSeconds}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2B7FFF] [&::-webkit-slider-thumb]:shadow-[0_0_0_6px_rgba(43,127,255,0.28)] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#2B7FFF]"
              style={{
                background: `linear-gradient(to right, #2B7FFF 0%, #2B7FFF ${pct}%, #3f3f46 ${pct}%, #3f3f46 100%)`,
              }}
            />
            <span className="w-14 shrink-0 text-right text-[14px] text-zinc-100">
              {t('psdControl.dock.seconds', { value })}
            </span>
          </div>
        )}

        {showWarning ? (
          <p className="mb-8 flex items-start gap-2 text-[13px] leading-relaxed text-[#f87171]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warningText}
          </p>
        ) : (
          <div className="mb-8" />
        )}

        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} className="text-[14px] text-zinc-100 hover:text-white">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setStep('verify')}
            className={`rounded-lg px-5 py-2 text-[14px] ${
              dirty ? 'bg-[#2B7FFF] text-white hover:bg-[#1d6feb]' : 'cursor-not-allowed bg-zinc-700 text-zinc-400'
            }`}
          >
            {t('psdControl.dock.next')}
          </button>
        </div>
      </div>

      {step === 'verify' ? (
        <ConfirmVerifyDialog
          onClose={() => setStep('edit')}
          onSave={() => onApply(value)}
        />
      ) : null}
    </div>
  );
}
