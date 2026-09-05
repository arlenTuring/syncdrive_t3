import { Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ATTRIBUTES_PANEL_HEADER_PADDING_TOP_PX,
  ATTRIBUTES_PANEL_PADDING_TOP_PX,
  createDraftAttribute,
  isAttributeNameWithinLimit,
  type TimeSlotAttribute,
} from '../types/editor';
import { PanelNoData } from './PanelNoData';
import { TimeSlotAttributeCard } from './TimeSlotAttributeCard';
import {
  TimeTemplatePanelAddButton,
  TimeTemplatePanelTitle,
} from './TimeTemplatePanelHeader';
import { VehicleCapacitySlider } from './VehicleCapacitySlider';

type TimeSlotAttributesPanelProps = {
  attributes: TimeSlotAttribute[];
  vehicleCapacity: number;
  onVehicleCapacityChange: (value: number) => void;
  onChange: (attributes: TimeSlotAttribute[]) => void;
  /** 基本資料區塊已含載運量時設為 false */
  showVehicleCapacity?: boolean;
};

export function TimeSlotAttributesPanel({
  attributes,
  vehicleCapacity,
  onVehicleCapacityChange,
  onChange,
  showVehicleCapacity = true,
}: TimeSlotAttributesPanelProps) {
  const { t } = useTranslation();
  const hasDraft = attributes.some((attr) => attr.isDraft);

  const addAttribute = () => {
    if (hasDraft) return;
    onChange([...attributes, createDraftAttribute(attributes.length)]);
  };

  const updateAttribute = (id: string, patch: Partial<TimeSlotAttribute>) => {
    onChange(attributes.map((attr) => (attr.id === id ? { ...attr, ...patch } : attr)));
  };

  const confirmAttribute = (id: string) => {
    const attr = attributes.find((item) => item.id === id);
    if (!attr) return;
    if (!attr.name.trim() || attr.headwaySeconds == null || attr.headwaySeconds <= 0) return;
    if (!isAttributeNameWithinLimit(attr.name.trim())) return;
    updateAttribute(id, { isDraft: false, name: attr.name.trim() });
  };

  const startEdit = (id: string) => {
    updateAttribute(id, { isDraft: true });
  };

  const removeAttribute = (id: string) => {
    onChange(attributes.filter((attr) => attr.id !== id));
  };

  return (
    <section
      className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-[rgba(142,197,255,0.08)] pb-1.5"
      style={{ paddingTop: ATTRIBUTES_PANEL_PADDING_TOP_PX }}
    >
      {/* Top row: title · optional slider · add button */}
      <div
        className={`grid shrink-0 items-start gap-x-3 px-3 pb-0.5 ${
          showVehicleCapacity
            ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto]'
        }`}
        style={{ paddingTop: ATTRIBUTES_PANEL_HEADER_PADDING_TOP_PX }}
      >
        <div className="flex h-9 items-center">
          <TimeTemplatePanelTitle
            icon={<Tag className="size-5" strokeWidth={1.75} />}
            title={t('timeTemplates.attributes.title')}
          />
        </div>

        {showVehicleCapacity && (
          <div className="flex min-w-0 justify-center px-2">
            <div className="w-[46%] min-w-[200px] max-w-[22rem]">
              <VehicleCapacitySlider
                value={vehicleCapacity}
                onChange={onVehicleCapacityChange}
              />
            </div>
          </div>
        )}

        <div className="flex h-9 items-center justify-end">
          <TimeTemplatePanelAddButton onClick={addAttribute} disabled={hasDraft} />
        </div>
      </div>

      {/* Bottom: attribute cards left-aligned under title */}
      <div className="overflow-hidden pl-3 pr-3 pt-0.5">
        {attributes.length === 0 ? (
          <PanelNoData className="justify-start pt-1" />
        ) : (
          <div className="flex items-start gap-3 overflow-x-auto pb-0.5">
            {attributes.map((attr) => (
              <TimeSlotAttributeCard
                key={attr.id}
                attribute={attr}
                onChange={(patch) => updateAttribute(attr.id, patch)}
                onConfirm={() => confirmAttribute(attr.id)}
                onDelete={() => removeAttribute(attr.id)}
                onStartEdit={() => startEdit(attr.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
