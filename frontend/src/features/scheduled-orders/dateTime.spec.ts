import { describe, expect, it } from "vitest";
import {
  addCivilDays,
  civilToEpoch,
  dayKey,
  formatWeekday,
  weekStart,
} from "./dateTime";

describe("scheduled order civil dates", () => {
  it("uses the website timezone rather than the browser timezone", () => {
    const epoch = civilToEpoch("2026-10-23T00:00:00", "Asia/Taipei");
    expect(new Date(epoch).toISOString()).toBe("2026-10-22T16:00:00.000Z");
    expect(dayKey(epoch, "Asia/Taipei")).toBe("2026-10-23");
  });

  it("navigates across month and year boundaries", () => {
    expect(addCivilDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCivilDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("uses Sunday as the first day of a week", () => {
    expect(weekStart("2027-06-10")).toBe("2027-06-06");
  });

  it("renders the weekday from the website timezone and civil date", () => {
    expect(formatWeekday("2026-10-23", "Asia/Taipei")).toBe("星期五");
  });
});
