// ACT public holidays, committed table (no runtime fetch). Used only for the
// Competency 23 reminder (NI2020-703: "NOT to be assessed on Sundays or ACT
// Public Holidays"), see lib/rules.ts and the 2026-10-10 rules-reminders spec (D16).
//
// SOURCE (official, read on 2026-10-10 from legislation.act.gov.au):
//  - Holidays Act 1958 (A1958-19), s 3(1)(a), republication R11 (in force since
//    1 January 2018, the latest republication): fixed and floating holidays.
//    https://www.legislation.act.gov.au/a/1958-19
//  - NI2026-154 Holidays (Anzac Day Additional Public Holiday 2026) Declaration
//    2026 (No 1): Monday 27 April 2026 is an additional public holiday; it revokes
//    NI2025-650, which had declared Saturday 25 April 2026 NOT a holiday, so
//    Saturday 25 April 2026 stays a holiday under the Act.
//    https://www.legislation.act.gov.au/ni/2026-154
//  - NI2026-387 Holidays (Anzac Day Additional Public Holiday 2027) Declaration
//    2026 (No 1): Sunday 25 April 2027 is an additional public holiday (Monday
//    26 April 2027 is one under the Act, as 25 April is a Sunday).
//    https://www.legislation.act.gov.au/ni/2026-387
// The ACT Government public-holidays page and its PDFs returned HTTP 403 to the
// build environment, so the dates were derived from the instruments above
// (not copied from that page). Cross-check against
// https://www.act.gov.au/living-in-the-act/public-holidays-school-terms-and-daylight-saving
// at the next yearly update. Other ministerial declarations (Holidays Act s 3(1)(b), (2))
// could add or remove a day in a year; none other than the two above were found.
//
// HOW THE DATES FOLLOW FROM THE ACT (s 3(1)(a)):
//  New Year's Day 1 Jan (Sat/Sun -> following Monday); Australia Day 26 Jan (same);
//  Canberra Day 2nd Monday in March; Good Friday; Saturday after Good Friday; Easter
//  Sunday; Easter Monday; Anzac Day 25 Apr (Sunday -> following Monday); Reconciliation
//  Day 27 May, or the following Monday if not a Monday; Sovereign's birthday 2nd Monday
//  in June; Labour Day 1st Monday in October; Christmas Day 25 Dec (Sat -> following
//  Monday, Sun -> following Tuesday); Boxing Day 26 Dec (same rule).
//
// YEARLY UPDATE PROCEDURE (BACKLOG item, every October): add the next year's
// dates here from the Act's rules plus any declarations on legislation.act.gov.au
// (Holidays Act 1958 s 3 notifiable instruments) and the ACT Government list; append
// the year to COVERED_YEARS; keep the list sorted by date with no duplicates
// (tests/act-public-holidays.test.ts checks the shape). Outside COVERED_YEARS the app
// says "not loaded; check manually" and never shows a pass. There is deliberately no
// test that depends on today's date.

export type ActHoliday = { date: string; name: string };

/** Years whose holidays are fully listed below. */
export const COVERED_YEARS: readonly number[] = [2026, 2027];

export const ACT_PUBLIC_HOLIDAYS: readonly ActHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-26", name: "Australia Day" },
  { date: "2026-03-09", name: "Canberra Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-04", name: "Easter Saturday" },
  { date: "2026-04-05", name: "Easter Sunday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-04-25", name: "Anzac Day" },
  { date: "2026-04-27", name: "Anzac Day additional public holiday" },
  { date: "2026-06-01", name: "Reconciliation Day" },
  { date: "2026-06-08", name: "King's Birthday" },
  { date: "2026-10-05", name: "Labour Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2026-12-28", name: "Boxing Day additional public holiday" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-26", name: "Australia Day" },
  { date: "2027-03-08", name: "Canberra Day" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-27", name: "Easter Saturday" },
  { date: "2027-03-28", name: "Easter Sunday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-04-25", name: "Anzac Day additional public holiday" },
  { date: "2027-04-26", name: "Anzac Day" },
  { date: "2027-05-31", name: "Reconciliation Day" },
  { date: "2027-06-14", name: "King's Birthday" },
  { date: "2027-10-04", name: "Labour Day" },
  { date: "2027-12-25", name: "Christmas Day" },
  { date: "2027-12-26", name: "Boxing Day" },
  { date: "2027-12-27", name: "Christmas Day additional public holiday" },
  { date: "2027-12-28", name: "Boxing Day additional public holiday" },
];

export type HolidayLookup = { kind: "holiday"; name: string } | { kind: "none" } | { kind: "not_loaded"; year: number };

/** Whether a "YYYY-MM-DD" date is an ACT public holiday; "not_loaded" when its year is not in COVERED_YEARS. */
export function lookupActHoliday(date: string, table: readonly ActHoliday[] = ACT_PUBLIC_HOLIDAYS, covered: readonly number[] = COVERED_YEARS): HolidayLookup {
  const year = Number(date.slice(0, 4));
  if (!covered.includes(year)) return { kind: "not_loaded", year };
  const hit = table.find((h) => h.date === date);
  return hit ? { kind: "holiday", name: hit.name } : { kind: "none" };
}
