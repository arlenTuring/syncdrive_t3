export type StatusTagStyle = {
  container: string;
  dot: string;
};

type StatusTagProps = {
  label: string;
  style: StatusTagStyle;
};

export function StatusTag({ label, style }: StatusTagProps) {
  return (
    <span
      className={`inline-flex h-[26px] w-fit max-w-none flex-none items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1 ${style.container}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${style.dot}`} />
      <span className="shrink-0 text-sm font-medium leading-[18px] tracking-[0.5px] text-[#F3F4F6]">
        {label}
      </span>
    </span>
  );
}
