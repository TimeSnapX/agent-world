// Brisbane time helpers. Australia/Brisbane is UTC+10 all year (no daylight saving),
// so a fixed offset is exact and needs no timezone database.
const OFFSET = 10 * 3600_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface BneNow { dow: number; day: number; month: number; year: number; hour: number; minute: number; date: Date }
export function bne(now: Date = new Date()): BneNow {
  const b = new Date(now.getTime() + OFFSET);
  return { dow: b.getUTCDay(), day: b.getUTCDate(), month: b.getUTCMonth(), year: b.getUTCFullYear(), hour: b.getUTCHours(), minute: b.getUTCMinutes(), date: b };
}
export function longDate(n: BneNow): string { return `${DAYS[n.dow]} ${n.day} ${MONTHS[n.month]} ${n.year}`; }
function shortDay(b: Date): string { return `${DAYS[b.getUTCDay()].slice(0, 3)} ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()].slice(0, 3)}`; }

/** Work days are Monday to Friday with a 5:00am start. */
export function workDay(n: BneNow): { work: boolean; text: string } {
  const work = n.dow >= 1 && n.dow <= 5;
  if (!work) return { work, text: "Not a work day (work is Mon to Fri)" };
  const mins = n.hour * 60 + n.minute;
  if (mins < 300) { const left = 300 - mins; return { work, text: `Work day · 5:00am start, in ${Math.floor(left / 60)}h ${left % 60}m` }; }
  return { work, text: "Work day · started 5:00am" };
}
/** Randstad pays on Thursday. */
export function payday(n: BneNow): { days: number; text: string } {
  const days = (4 - n.dow + 7) % 7;
  if (days === 0) return { days, text: "Payday today (Thursday, Randstad)" };
  const d = new Date(n.date.getTime() + days * 86400_000);
  return { days, text: `${days} day${days === 1 ? "" : "s"} to payday · ${shortDay(d)} (Randstad)` };
}
/** Bedtime target is shown only on Sunday to Thursday nights (work the next morning). */
export function bedtime(n: BneNow): string | null {
  return n.dow <= 4 ? "Bed 9:00 to 9:30pm tonight (work tomorrow)" : null;
}
/** Hours between two HH:MM times; wraps past midnight. */
export function hoursBetween(a: string, b: string): number | null {
  const p = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : null; };
  const x = p(a), y = p(b);
  if (x == null || y == null) return null;
  let d = y - x; if (d < 0) d += 1440;
  return Math.round((d / 60) * 100) / 100;
}
