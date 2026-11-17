import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';
import { ERROR_TEXT_CLASS, fieldClass, HINT_CLASS, LABEL_CLASS, type FieldSize } from '../variants';

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: FieldSize;
  invalid?: boolean;
};

/** 系統輸入框（text、number、password、search、date…）；className 只用來排版 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', invalid = false, className, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldClass({ size, invalid }), className)} {...rest} />;
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid = false, className, ...rest },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(fieldClass({ invalid, multiline: true }), className)} {...rest} />;
});

/**
 * 欄位外框：標籤＋輸入元件＋說明／錯誤訊息。
 * children 是函式時會拿到 id，交給輸入元件讓標籤點得到它。
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required ? <span className="ml-0.5 text-status-error-emphasis">*</span> : null}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <p className={ERROR_TEXT_CLASS}>{error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}
    </div>
  );
}
