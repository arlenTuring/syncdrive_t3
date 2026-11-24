import { DatePickerPanel } from '../../../components/ui';

/**
 * 日期＋時間面板（DatePicker 規格的 Date + Time：單一日期面板加時、分、秒欄，「確定」提交）。
 * 外觀與行為都在 components/ui 的 DatePickerPanel；這裡只保留原本的呼叫介面。
 */
export type CustomDateTimePanelProps = {
  value: Date | null;
  onConfirm: (next: Date) => void;
};

export function CustomDateTimePanel({ value, onConfirm }: CustomDateTimePanelProps) {
  return <DatePickerPanel mode="dateTime" value={value} arrow onChange={(next) => onConfirm(next as Date)} />;
}
