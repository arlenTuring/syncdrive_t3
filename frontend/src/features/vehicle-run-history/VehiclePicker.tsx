import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VehicleOption } from "./api";
import { matchVehicle } from "./queryConditions";

/**
 * 調查載具選擇：已註冊載具（含停用），可用名稱或通訊代號搜尋。值是穩定識別（id），
 * 畫面顯示名稱；不以名稱關聯任何資料。
 */
export function VehiclePicker({
  options,
  value,
  onChange,
  loading,
  error,
}: {
  options: readonly VehicleOption[];
  value: string | null;
  onChange: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.id === value) ?? null;
  const filtered = useMemo(() => options.filter((item) => matchVehicle(item, query)), [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (item: VehicleOption) => {
    onChange(item.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <span className="mb-1 block text-zinc-400">
        調查載具 <span className="text-red-300">*</span>
      </span>
      <div className="relative">
        <input
          role="combobox"
          aria-label="調查載具"
          aria-expanded={open}
          aria-controls={listId}
          aria-required="true"
          value={open ? query : selected ? labelOf(selected) : ""}
          placeholder={loading ? "載入載具清單…" : "搜尋名稱或通訊代號"}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(filtered.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" && open && filtered[active]) {
              event.preventDefault();
              pick(filtered[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full rounded-lg bg-zinc-800 px-3 py-2 pr-8"
        />
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-500" />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-zinc-500">{error ? `載具清單載入失敗：${error}` : "沒有符合的載具"}</li>
          ) : (
            filtered.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={item.id === value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${index === active ? "bg-zinc-800" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-zinc-100">{item.display_name}</span>
                {item.display_name !== item.vehicle_code ? <span className="font-mono text-xs text-zinc-500">{item.vehicle_code}</span> : null}
                {!item.is_active ? <span className="rounded bg-zinc-700 px-1 text-[10px] text-zinc-300">已停用</span> : null}
                {item.history_last_real == null ? <span className="text-[10px] text-zinc-500">無歷史</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** 名稱與通訊代號相同時只寫一次 */
function labelOf(vehicle: VehicleOption): string {
  return vehicle.display_name === vehicle.vehicle_code ? vehicle.display_name : `${vehicle.display_name}（${vehicle.vehicle_code}）`;
}
