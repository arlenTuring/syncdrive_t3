type PanelNoDataProps = {
  className?: string;
  message?: string;
};

export function PanelNoData({ className = '', message = 'No Data' }: PanelNoDataProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 ${className}`}
    >
      <div className="flex h-[37.82px] w-full items-center justify-center py-2">
        <img
          src="/shift-mgt-icons/nodata.png"
          alt=""
          className="h-[21.82px] w-[63.5px] opacity-90"
          width={64}
          height={22}
        />
      </div>
      <span className="text-sm font-medium leading-[18px] tracking-[0.5px] text-[#D1D5DC]">
        {message}
      </span>
    </div>
  );
}
