import { SiteSelect } from '../../../components/SiteSelect';
import { LayoutDashboard } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listStoredDashboardPlanes } from '../utils/moduleDashboardPages';
import { Button, Dialog, TextInput } from '../../../components/ui';

type AttachModuleDashboardDialogProps = {
  moduleLabel: string;
  onCancel: () => void;
  onConfirm: (args: { planeId: string; label: string }) => void;
};

export function AttachModuleDashboardDialog({
  moduleLabel,
  onCancel,
  onConfirm,
}: AttachModuleDashboardDialogProps) {
  const { t } = useTranslation();
  const planes = useMemo(() => listStoredDashboardPlanes(), []);
  const [planeId, setPlaneId] = useState(planes[0]?.id ?? '');
  const [label, setLabel] = useState(planes[0]?.name ?? '');

  const selected = planes.find((plane) => plane.id === planeId) ?? null;

  return (
    <Dialog
      title={t('shell.attachDashboard.title')}
      description={moduleLabel}
      onClose={onCancel}
      footer={
        <>
          <Button hierarchy="subordinate" variant="tonal" onPress={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!planeId || !label.trim()}
            onPress={() => {
              if (!planeId || !label.trim()) return;
              onConfirm({ planeId, label: label.trim() });
            }}
          >
            {t('shell.attachDashboard.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
          {planes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-quaternary bg-surface-primary px-4 py-8 text-center">
              <LayoutDashboard className="mx-auto size-8 text-text-disabled" />
              <p className="mt-3 text-body-s text-text-secondary">
                {t('shell.attachDashboard.emptyTitle')}
              </p>
              <p className="mt-1 text-body-xs text-text-quaternary">
                {t('shell.attachDashboard.emptyHint')}
              </p>
            </div>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-body-xs-bold text-text-tertiary">
                  {t('shell.attachDashboard.selectPlane')}
                </span>
                <SiteSelect
                  value={planeId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setPlaneId(nextId);
                    const plane = planes.find((item) => item.id === nextId);
                    if (plane) setLabel(plane.name);
                  }}
                  size="md"
                  className="w-full"
                >
                  {planes.map((plane) => (
                    <option key={plane.id} value={plane.id}>
                      {t('shell.attachDashboard.planeOption', {
                        name: plane.name,
                        width: plane.width,
                        height: plane.height,
                      })}
                    </option>
                  ))}
                </SiteSelect>
              </label>

              <label className="block space-y-1.5">
                <span className="text-body-xs-bold text-text-tertiary">
                  {t('shell.attachDashboard.pageName')}
                </span>
                <TextInput
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={t('shell.attachDashboard.pageNamePlaceholder')}
                />
              </label>

              {selected ? (
                <p className="text-body-xs text-text-quaternary">
                  {t('shell.attachDashboard.viewModeHint', { name: selected.name })}
                </p>
              ) : null}
            </>
          )}
        </div>
    </Dialog>
  );
}
