/**
 * 系統共用 UI 元件。頁面一律從這裡取用，不要各自再寫按鈕、輸入框、對話框、狀態標籤的樣式。
 * 規則：.claude/skills/t3-ui-design/SKILL.md；tokens：styles/design-tokens.css、styles/tokens.ts。
 */
export { Badge, type BadgeColors, type BadgeSize } from './badge/Badge';
export {
  Button,
  IconButton,
  type ButtonHierarchy,
  type ButtonProps,
  type ButtonStyle,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonStyle,
} from './button/Button';
export {
  Checkbox,
  CheckboxIndicator,
  type CheckboxChecked,
  type CheckboxProps,
  type CheckboxSize,
  type CheckboxVariant,
} from './checkbox/Checkbox';
export { cn } from './cn';
export { Dialog, type DialogProps } from './dialog/Dialog';
export { Field, TextArea, TextInput, type TextAreaProps, type TextInputProps } from './field/Field';
export { Panel } from './panel/Panel';
export { Radio, RadioGroup, type RadioOption, type RadioProps, type RadioSize } from './radio/Radio';
export { headerCheckState } from './checkbox/selection';
export { Switch, type SwitchConfiguration, type SwitchProps } from './switch/Switch';
export { SegmentedControl, Tabs, type TabItem } from './tabs/Tabs';
export {
  buttonAttributes,
  badgeToneColors,
  DIALOG_OVERLAY_CLASS,
  DIALOG_PANEL_CLASS,
  ERROR_TEXT_CLASS,
  fieldClass,
  HINT_CLASS,
  LABEL_CLASS,
  MENU_BADGE_CLASS,
  MENU_CHECK_CLASS,
  MENU_EMPTY_CLASS,
  MENU_GROUP_LABEL_CLASS,
  MENU_PANEL_CLASS,
  menuItemClass,
  PLACEHOLDER_TEXT_CLASS,
  TRIGGER_ICON_CLASS,
  surfaceClass,
  type BadgeTone,
  type DialogSize,
  type FieldSize,
  type SurfaceLevel,
} from './variants';
