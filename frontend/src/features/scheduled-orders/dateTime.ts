const parts = (value: number, timeZone: string) => {
  const result: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .forEach((part) => {
      if (part.type !== "literal") result[part.type] = part.value;
    });
  return result;
};
export const dayKey = (value: number, timeZone: string) => {
  const p = parts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
};
export const formatDateTime = (value: number | null, timeZone: string) => {
  if (!value) return "—";
  const p = parts(value, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
export const formatWeekday = (key: string, timeZone: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone, weekday: "long" }).format(
    new Date(civilToEpoch(key, timeZone)),
  );
export const addCivilDays = (key: string, amount: number) => {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};
export const civilToEpoch = (civil: string, timeZone: string) => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(civil);
  if (!match) return NaN;
  const wanted = Date.UTC(
    +match[1],
    +match[2] - 1,
    +match[3],
    +(match[4] ?? 0),
    +(match[5] ?? 0),
    +(match[6] ?? 0),
  );
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(guess, timeZone);
    const observed = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    guess += wanted - observed;
  }
  return guess;
};
export const weekStart = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return addCivilDays(key, -date.getUTCDay());
};
