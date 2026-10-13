// Overseas / interstate licence held by the learner (learner intake design 2026-10-11, Feature 2, D11-D13;
// migration 0013). Pure: constants, labels and the server/client validation of the six fields. No clock
// inside (`today` is passed in), no database, no network. The RULE (how the licence changes the Competency 23
// wait) lives in lib/rules.ts with the other R2 logic; this file only knows the field shapes.
//
// Tony's school rule (confirmed with the authority 2026-10-11, corrected 2026-10-12; design §1, §9 Q1-Q5):
//   - any country is fine, but only a FULL licence counts as a full licence;
//   - an INTERSTATE learner licence's time counts towards the 12 / 6-month wait, like ACT learner time;
//   - an OVERSEAS learner licence does NOT count;
//   - an interstate or overseas FULL licence held >= 12 months (issue date to the drive date) removes the wait;
//     hours, HPT and age are still checked;
//   - the other licence's expiry is information only (Q4): no rule reads it, it is not required.
// Everything about it is a REMINDER for the instructor; nothing here blocks a save. Never sent to ACTGDS (D23).

/** NULL in D1 = not recorded ("—" in the form). */
export const OTHER_LICENCE_KINDS = ["none", "interstate", "overseas"] as const;
export type OtherLicenceKind = (typeof OTHER_LICENCE_KINDS)[number];

/** NULL = not recorded. `other` = provisional, permit, restricted or unknown kinds: never counts (design §9 assumption). */
export const OTHER_LICENCE_CLASSES = ["learner", "full", "other"] as const;
export type OtherLicenceClass = (typeof OTHER_LICENCE_CLASSES)[number];

/** Australian states and territories other than the ACT (an ACT licence is the learner's own licence, recorded above). */
export const INTERSTATE_PLACES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT"] as const;
export const MAX_OTHER_PLACE_LENGTH = 60;
export const MAX_OTHER_NUMBER_LENGTH = 40;

/** D11: the one-line hint under the group, in Tony's words. */
export const OTHER_LICENCE_HINT = "Interstate learner time counts towards the wait; an interstate or overseas full licence held 12 months removes it; overseas learner licences do not count.";

export const OTHER_LICENCE_KIND_LABELS: Record<OtherLicenceKind, string> = { none: "No", interstate: "Yes, interstate", overseas: "Yes, overseas" };
export const OTHER_LICENCE_CLASS_LABELS: Record<OtherLicenceClass, string> = { learner: "Learner", full: "Full (unrestricted car licence)", other: "Other (provisional, permit, restricted…)" };

/** The six stored fields as the app reads them (null = not recorded). `Learner` (lib/types.ts) satisfies this. */
export type OtherLicenceFields = {
  otherLicenceKind: string | null;
  otherLicencePlace: string | null;
  otherLicenceNumber: string | null;
  otherLicenceClass: string | null;
  otherLicenceIssuedOn: string | null;
  otherLicenceExpiresOn: string | null;
};
export const OTHER_LICENCE_KEYS = ["otherLicenceKind", "otherLicencePlace", "otherLicenceNumber", "otherLicenceClass", "otherLicenceIssuedOn", "otherLicenceExpiresOn"] as const satisfies readonly (keyof OtherLicenceFields)[];
/** The detail fields: only meaningful with kind interstate / overseas; cleared when the answer is "No" (D12). */
export const OTHER_LICENCE_DETAIL_KEYS = ["otherLicencePlace", "otherLicenceNumber", "otherLicenceClass", "otherLicenceIssuedOn", "otherLicenceExpiresOn"] as const;

export const isOtherLicenceKind = (value: unknown): value is OtherLicenceKind => (OTHER_LICENCE_KINDS as readonly unknown[]).includes(value);
export const isOtherLicenceClass = (value: unknown): value is OtherLicenceClass => (OTHER_LICENCE_CLASSES as readonly unknown[]).includes(value);
/** Interstate or overseas: the kinds whose details the rule reads. */
export const holdsOtherLicence = (kind: string | null | undefined): kind is "interstate" | "overseas" => kind === "interstate" || kind === "overseas";

/**
 * The licence as the reminders name it: "NSW learner licence", "full NSW licence", "full licence from Germany",
 * "overseas learner licence" (no place), "interstate full licence" (no place).
 */
export function otherLicenceLabel(fields: Pick<OtherLicenceFields, "otherLicenceKind" | "otherLicenceClass" | "otherLicencePlace">): string {
  const cls = fields.otherLicenceClass === "full" ? "full" : fields.otherLicenceClass === "learner" ? "learner" : "";
  const place = (fields.otherLicencePlace ?? "").trim();
  if (fields.otherLicenceKind === "interstate") {
    if (!place) return cls ? `interstate ${cls} licence` : "interstate licence";
    return cls === "full" ? `full ${place} licence` : cls ? `${place} ${cls} licence` : `${place} licence`;
  }
  if (!place) return cls ? `overseas ${cls} licence` : "overseas licence";
  return cls ? `${cls} licence from ${place}` : `licence from ${place}`;
}

export type OtherLicenceValidation = { ok: true; fields: OtherLicenceFields } | { ok: false; error: string };

/**
 * D12 cross-field rules on the MERGED values (stored learner + the keys being changed), applied only when one of
 * the six keys (or `dob`) is being changed, so an unrelated edit is never blocked by older data. The caller has
 * already parsed each date as a real calendar date (lib/repo.ts#realDate). Returns the normalised fields to store
 * (trimmed, upper-case state and number) or one clear error. `today` is the Canberra date.
 *   - kind: null | none | interstate | overseas; class: null | learner | full | other;
 *   - details (place, number, class, dates) need kind interstate / overseas; "No" or not recorded clears nothing
 *     silently: the client clears, the server refuses leftovers with a clear message;
 *   - place: a state/territory other than ACT for interstate; 1-60 characters for overseas;
 *   - number <= 40 characters, stored upper-case;
 *   - issue date on or before today and on or after the DOB; expiry on or after the issue date (both optional, Q3/Q4).
 */
export function validateOtherLicence(merged: OtherLicenceFields & { dob: string | null }, touched: ReadonlySet<string>, today: string): OtherLicenceValidation | null {
  if (!OTHER_LICENCE_KEYS.some((key) => touched.has(key)) && !touched.has("dob")) return null;
  const kind = merged.otherLicenceKind;
  if (kind !== null && !isOtherLicenceKind(kind)) return { ok: false, error: "Overseas or interstate licence must be No, Interstate or Overseas." };
  const cls = merged.otherLicenceClass;
  if (cls !== null && !isOtherLicenceClass(cls)) return { ok: false, error: "Other licence type must be Learner, Full or Other." };
  const place = merged.otherLicencePlace?.trim() || null;
  const number = merged.otherLicenceNumber?.trim().toUpperCase() || null;
  const issued = merged.otherLicenceIssuedOn;
  const expires = merged.otherLicenceExpiresOn;
  if (!holdsOtherLicence(kind)) {
    if (place || number || cls || issued || expires) {
      return { ok: false, error: kind === "none" ? 'The other licence details were sent with "No": clear them, or choose Interstate or Overseas.' : "Choose Interstate or Overseas before adding the other licence's details." };
    }
    return { ok: true, fields: { otherLicenceKind: kind, otherLicencePlace: null, otherLicenceNumber: null, otherLicenceClass: null, otherLicenceIssuedOn: null, otherLicenceExpiresOn: null } };
  }
  let storedPlace = place;
  if (kind === "interstate" && place) {
    storedPlace = place.toUpperCase();
    if (!(INTERSTATE_PLACES as readonly string[]).includes(storedPlace)) return { ok: false, error: `Interstate licence state must be one of ${INTERSTATE_PLACES.join(", ")} (an ACT licence is the learner's own licence).` };
  }
  if (kind === "overseas" && place && place.length > MAX_OTHER_PLACE_LENGTH) return { ok: false, error: `Overseas licence country must be 1 to ${MAX_OTHER_PLACE_LENGTH} characters.` };
  if (number && number.length > MAX_OTHER_NUMBER_LENGTH) return { ok: false, error: `Other licence number must be at most ${MAX_OTHER_NUMBER_LENGTH} characters.` };
  // Only when the dates themselves (or the DOB) change: re-sending stored dates with an unrelated edit never blocks (touched is the set of CHANGED keys).
  if (issued && touched.has("otherLicenceIssuedOn") && issued > today) return { ok: false, error: "Other licence issue date cannot be in the future." };
  if (issued && merged.dob && (touched.has("otherLicenceIssuedOn") || touched.has("dob")) && issued < merged.dob) return { ok: false, error: "Other licence issue date cannot be before the date of birth." };
  if (issued && expires && (touched.has("otherLicenceIssuedOn") || touched.has("otherLicenceExpiresOn")) && expires < issued) return { ok: false, error: "Other licence expiry cannot be before its issue date." };
  return { ok: true, fields: { otherLicenceKind: kind, otherLicencePlace: storedPlace, otherLicenceNumber: number, otherLicenceClass: cls, otherLicenceIssuedOn: issued, otherLicenceExpiresOn: expires } };
}

/**
 * English short names of the world's countries (UN members and observers plus the common licence-issuing places),
 * for the overseas country `<datalist>` suggestion (D11). Suggestion only: any text up to 60 characters saves.
 */
export const COUNTRIES: readonly string[] = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (Brazzaville)", "Congo (Kinshasa)", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
  "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Macao", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
  "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "São Tomé and Príncipe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];
