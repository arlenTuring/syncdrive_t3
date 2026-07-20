import { sanitizeIntegerInput } from '../../maintenance-tasks/utils/numericInput';
import { TriggerFieldRow } from '../../maintenance-tasks/components/TriggerFieldRow';

type MainlineSlackSecondsFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefixText: string;
  suffixText?: string;
};

/** 班表策略餘裕：正線優先讓渡／空時段正線讓渡 */
export function MainlineSlackSecondsField({
  label,
  value,
  onChange,
  prefixText,
  suffixText = '秒；超出則不排',
}: MainlineSlackSecondsFieldProps) {
  return (
    <TriggerFieldRow
      label={label}
      showToggle={false}
      required
      enabled
      value={value}
      onEnabledChange={() => {}}
      onValueChange={onChange}
      prefixText={prefixText}
      suffixText={suffixText}
      sanitizeValue={sanitizeIntegerInput}
    />
  );
}
