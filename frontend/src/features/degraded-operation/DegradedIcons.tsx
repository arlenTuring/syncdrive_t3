/**
 * 降級運轉頁指定的圖示（frontend/public/dowgrade-operation-icons，目錄名稱照實際拼字）。
 * 原檔都是 24×24 viewBox、透明底、自帶藍色；用 <img> 原樣顯示，只給等寬等高，不重新著色、不拉伸。
 */
const ICONS = {
  speed: "speed_limit.svg",
  capacity: "capacity-loss.svg",
  shifts: "affect-shifts.svg",
} as const;

export type DegradedIconName = keyof typeof ICONS;

export function degradedIconUrl(name: DegradedIconName): string {
  return `/dowgrade-operation-icons/${ICONS[name]}`;
}

export function DegradedIcon({
  name,
  className = "size-6",
}: {
  name: DegradedIconName;
  className?: string;
}) {
  return (
    <img
      src={degradedIconUrl(name)}
      alt=""
      aria-hidden
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

/**
 * 速限／運能損失／影響班次三格。運能損失與影響班次還沒有定義算法，一律顯示「—」，
 * 不填示意數字。
 */
export function ImpactMetrics({
  speedLimitKmh,
  className = "",
}: {
  speedLimitKmh: number | null;
  className?: string;
}) {
  const cell = (
    icon: DegradedIconName,
    label: string,
    value: string,
    unit?: string,
  ) => (
    <div className="flex min-w-0 items-start gap-2">
      <DegradedIcon name={icon} className="mt-0.5 size-6" />
      <div className="min-w-0">
        <span className="block text-sm text-zinc-400">{label}</span>
        <b className="text-2xl font-normal text-white">{value}</b>
        {unit ? <small className="ml-1 text-xs text-zinc-400">{unit}</small> : null}
      </div>
    </div>
  );
  return (
    <div
      className={`grid grid-cols-3 gap-2 rounded-xl bg-[#222831] p-4 ${className}`}
    >
      {cell(
        "speed",
        "速限",
        speedLimitKmh == null ? "—" : String(speedLimitKmh),
        "km/h",
      )}
      {cell("capacity", "運能損失", "—", "%")}
      {cell("shifts", "影響班次", "—")}
    </div>
  );
}
