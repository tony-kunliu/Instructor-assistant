export const LICENCE_SCAN_FIELDS = {
  fullName: "Name",
  dob: "Date of birth",
  licenceNumber: "Licence number",
  licenceExpiry: "Expiry",
  address: "Address",
} as const;

type ScanField = keyof typeof LICENCE_SCAN_FIELDS;
export type LicenceScan = Partial<Record<ScanField, string>>;

const labels: readonly [ScanField | "given" | "family" | "ignore", RegExp][] = [
  ["licenceNumber", /^(?:(?:driver\s+)?licen[cs]e\s*(?:number|no\.?|#)|lic\.?\s*no\.?|licen[cs]e\s*#)\b/i],
  ["licenceExpiry", /^(?:(?:licen[cs]e\s+)?(?:date\s+of\s+expiry|expiry(?:\s+date)?|exp(?:\.?\s+date)?|expires)|valid\s+(?:until|to))\b/i],
  ["dob", /^(?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|birth\s*date|born)\b/i],
  ["given", /^(?:given\s+names?|first\s+names?)\b/i],
  ["family", /^(?:family\s+name|sur\s*name|last\s+name)\b/i],
  ["fullName", /^(?:full\s+name|learner\s+name|name)\b/i],
  ["address", /^(?:(?:residential\s+|home\s+)?address)\b/i],
  ["ignore", /^(?:card\s*(?:number|no\.?|#)|can\b|customer\s*(?:number|no\.?|#)|issue(?:d|\s+date)?|expiry\s+of\s+condition|class|conditions?|sex|signature)\b/i],
];
const cardHeader = /^(?:(?:act|australian capital territory)\s+)?(?:(?:learner|provisional|driver|driving|full)\s+){1,3}licen[cs]e\b/i;
const states = /\b(?:ACT|NSW|VIC|QLD|SA|WA|NT|TAS)\s?\d{4}\b/i;
const streetStart = /^(?:unit\s+|flat\s+|lot\s+)?\d+[a-z]?(?:[/-]\d+[a-z]?)?\s+\p{L}/iu;
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function readLabel(line: string) {
  for (const [key, re] of labels) {
    const match = re.exec(line);
    if (match) return { key, value: line.slice(match[0].length).replace(/^[.:;=\s#-]+/, "") };
  }
  return null;
}

function cardDate(text: string): string | undefined {
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})[./\s-]+(\d{1,2})[./\s-]+(\d{4})$/.exec(text);
  const named = /^(\d{1,2})[\s/-]+([a-z]{3,9})[\s/-]+(\d{4})$/i.exec(text);
  const bits = iso ? [iso[1], iso[2], iso[3]] : numeric ? [numeric[3], numeric[2], numeric[1]] : named
    ? [named[3], String(months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1), named[1]] : null;
  if (!bits) return;
  const [year, month, day] = bits.map(Number);
  if (year < 1900 || year > 2099) return;
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) === key) return key;
}

function cardName(text: string | undefined, split = false) {
  if (!text || text.length > 100 || !/^[\p{L}][\p{L}\p{M}\s.'’\-]+$/u.test(text)
    || /\b(?:australia|australian|territory|licen[cs]e|lic|card|learner|provisional|driver|department|transport|government|address|signature|specimen|sample|canberra)\b/i.test(text)) return;
  if (split || text.trim().split(/\s+/).length >= 2) return text;
}

function one(values: readonly string[]) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : undefined;
}

/** Suggests only existing learner fields. The original OCR text is never saved. */
export function parseLearnerLicence(text: string): LicenceScan {
  const lines = text.slice(0, 6000).normalize("NFKC").split(/\r?\n/)
    .map((line) => line.trim().replace(/[\t ]+/g, " ")).filter(Boolean);
  const raw: Partial<Record<ScanField | "given" | "family", string[]>> = {};
  for (let i = 0; i < lines.length; i++) {
    const labelled = readLabel(lines[i]);
    if (!labelled || labelled.key === "ignore") continue;
    const { key } = labelled;
    let value = labelled.value;
    let next = i + 1;
    if (!value && lines[next] && !readLabel(lines[next])) value = lines[next++];
    if (key === "address" && value) {
      while (!states.test(value) && lines[next] && !readLabel(lines[next]) && next <= i + 3
        && (states.test(lines[next]) || streetStart.test(lines[next]))) value += ` ${lines[next++]}`;
    }
    if (value) (raw[key] ??= []).push(value);
  }

  const typedName = cardName(one(raw.fullName ?? []));
  const given = cardName(one(raw.given ?? []), true);
  const family = cardName(one(raw.family ?? []), true);
  const joinedName = given && family ? `${given} ${family}` : undefined;
  const header = lines.findIndex((line) => cardHeader.test(line));
  // ACT cards can print the name and address without field labels. Only use neighbouring lines on recognised cards.
  const unlabelledName = header >= 0 && raw.licenceNumber && lines[header + 1] && !readLabel(lines[header + 1])
    ? cardName(lines[header + 1]) : undefined;
  const unlabelledAddresses = header >= 0 && raw.licenceNumber ? lines.flatMap((line, index) => {
    if (!streetStart.test(line)) return [];
    if (states.test(line)) return [line];
    return lines[index + 1] && states.test(lines[index + 1]) && !readLabel(lines[index + 1])
      ? [`${line} ${lines[index + 1]}`] : [];
  }) : [];
  const address = one(raw.address ?? unlabelledAddresses);
  const fullName = typedName ?? joinedName ?? (!raw.fullName && !raw.given && !raw.family ? unlabelledName : undefined);
  const number = one((raw.licenceNumber ?? []).map((value) => value.replace(/\s+/g, "").toUpperCase())
    .filter((value) => /^(?=.*\d)[A-Z0-9]{5,15}$/.test(value)));
  const dates = (key: "dob" | "licenceExpiry") => one((raw[key] ?? []).flatMap((value) => cardDate(value) ?? []));
  const dob = dates("dob");
  const expiry = dates("licenceExpiry");

  return {
    ...(fullName ? { fullName } : {}),
    ...(number ? { licenceNumber: number } : {}),
    ...(dob ? { dob } : {}),
    ...(expiry && (!dob || expiry > dob) ? { licenceExpiry: expiry } : {}),
    ...(address && streetStart.test(address) && states.test(address) && address.length <= 180 ? { address } : {}),
  };
}

export function mergeLicenceScan<T extends Record<ScanField, string>>(draft: T, scan: LicenceScan): T {
  const next = { ...draft };
  for (const key of Object.keys(LICENCE_SCAN_FIELDS) as ScanField[]) {
    if (!draft[key].trim() && scan[key]) Object.assign(next, { [key]: scan[key] });
  }
  return next;
}
