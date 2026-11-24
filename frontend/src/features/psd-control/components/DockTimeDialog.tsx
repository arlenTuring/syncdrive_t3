import { Lightbulb, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveDwellConflict, type DwellConflict } from '../resolveDwellConflict';
import { fetchVehicleStopDwellSeconds } from '../fetchVehicleStopDwell';
import { Button, Dialog, fieldClass } from '../../../components/ui';

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
    <Dialog
      title={t('psdControl.dock.dualVerify')}
      onClose={onClose}
      widthClassName="w-full max-w-[480px]"
      footer={(
        <>
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!ok} onPress={onSave}>{t('common.save')}</Button>
        </>
      )}
    >
        <div className="rounded-lg bg-surface-secondary px-4 py-4">
          <p className="mb-3 text-body-s text-text-primary">{t('psdControl.dock.confirmAndSave')}</p>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('psdControl.dock.confirmPlaceholder', { phrase })}
            className={fieldClass({ size: 'md', fullWidth: true })}
          />
        </div>
    </Dialog>
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
    <>
      <Dialog
        title={t('psdControl.dock.title')}
        onClose={onClose}
        widthClassName="max-w-[560px]"
        footer={(
          <>
            <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
            <Button disabled={!dirty} onPress={() => setStep('verify')}>{t('psdControl.dock.next')}</Button>
          </>
        )}
      >
      <div className="text-text-primary">
        <p className="mb-8 flex items-start gap-2 text-body-s text-text-tertiary">
          <Lightbulb className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-text-tertiary" aria-hidden />
          {t('psdControl.dock.hint')}
        </p>

        {!loaded ? (
          <p className="mb-8 text-body-s text-text-tertiary">{t('psdControl.dock.loading')}</p>
        ) : loadError || initial == null ? (
          <p className="mb-8 text-body-s text-status-error-emphasis">{loadError ?? t('psdControl.dock.noData')}</p>
        ) : (
          <div className="mb-6 flex items-center gap-4">
            <input
              type="range"
              min={MIN_SECONDS}
              max={maxSeconds}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-link-theme-filled [&::-webkit-slider-thumb]:shadow-[0_0_0_6px_var(--link-tonal)] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-link-theme-filled"
              style={{
                background: `linear-gradient(to right, var(--link-theme-filled) 0%, var(--link-theme-filled) ${pct}%, var(--link-standard-hover) ${pct}%, var(--link-standard-hover) 100%)`,
              }}
            />
            <span className="w-14 shrink-0 text-right text-body-s text-text-primary">
              {t('psdControl.dock.seconds', { value })}
            </span>
          </div>
        )}

        {showWarning ? (
          <p className="flex items-start gap-2 text-body-s text-status-error-emphasis">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warningText}
          </p>
        ) : null}
      </div>
      </Dialog>

      {step === 'verify' ? (
        <ConfirmVerifyDialog
          onClose={() => setStep('edit')}
          onSave={() => onApply(value)}
        />
      ) : null}
    </>
  );
}
