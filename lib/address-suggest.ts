// Address suggestions for the learner form (learner intake design 2026-10-11, Feature 1, D4/D6/D7).
// Pure: matches a typed address against the bundled G-NAF street index (public/data/streets-<release>.json,
// built by scripts/build-street-index.mjs) and decides when the picked suburb/state/postcode still belong
// to the text. No fetch, no DOM, no D1: the browser loads the index (app/address-input.tsx) and the server
// (lib/repo.ts) uses only the shape checks below, never the index.

/** Which index file public/data holds; the name carries the G-NAF release (D3). tests/address-suggest.test.ts checks it exists. */
export const STREET_INDEX_FILE = "streets-aug26.json";
export const STREET_INDEX_URL = `/data/${STREET_INDEX_FILE}`;
/** Attribution required by the Open G-NAF EULA / CC BY 4.0 (D1); shown in the app footer and in the data header. */
export const GNAF_ATTRIBUTION = "Street suggestions: G-NAF © Geoscape Australia (data.gov.au, CC BY 4.0)";

/** Suggestions start after this many typed letters of the street (D6) and show at most MAX_SUGGESTIONS (D4). */
export const MIN_STREET_LETTERS = 3;
export const MAX_SUGGESTIONS = 5;

/** Compact index layout: see the `_` header of the JSON file. */
export type StreetIndex = {
  _: { source: string; release: string; licence: string; attribution: string; entries: number; localities: number } & Record<string, unknown>;
  /** [name, state, postcode] */
  localities: [string, string, string][];
  /** [streetName, streetTypeAbbreviation ("" when none), localityIndex, postcode (only when it differs from the locality's)] */
  streets: ([string, string, number] | [string, string, number, string])[];
};

export type AddressSuggestion = {
  /** The unit/number token exactly as typed ("44", "3/44", "44A"); "" when none. Never verified (D4). */
  number: string;
  street: string;
  streetType: string;
  suburb: string;
  state: string;
  postcode: string;
  /** The text a pick puts in the Address field: "44 Appleford Av, Jacka ACT 2914". */
  label: string;
};

/** The structured fields stored with a picked suggestion (D7). All three go together. */
export type AddressParts = { suburb: string; state: string; postcode: string };

/** Australian states/territories accepted for address_state (D7). */
export const ADDRESS_STATES = ["ACT", "NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT"] as const;
export const MAX_SUBURB_LENGTH = 60;

export type ParsedQuery = { number: string; words: string[]; streetLetters: number };

/**
 * Splits the typed text into an optional number token (the first token when it holds a digit; kept as typed) and
 * the remaining words (lower-cased; commas ignored). streetLetters counts the letters typed after the number.
 */
export function parseAddressQuery(text: string): ParsedQuery {
  const tokens = text.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  let number = "";
  if (tokens.length && /\d/.test(tokens[0])) number = tokens.shift()!;
  const words = tokens.map((w) => w.toLowerCase());
  return { number, words, streetLetters: words.join("").replace(/[^a-z]/g, "").length };
}

type Candidate = { suggestion: AddressSuggestion; exactPrefix: boolean; stateRank: number; sortKey: string };

/**
 * D4 matching. The typed words (after the number) are matched as word prefixes against "<street name> <type>",
 * optionally continuing into the suburb ("44 appleford ja"). The first typed word may start at any word of the
 * street name ("cook" finds "Captain Cook Cres"); matches that start at the name's first word rank first
 * ("exact prefix first"), then ACT before NSW, then alphabetical. At most MAX_SUGGESTIONS results; none before
 * MIN_STREET_LETTERS letters of the street are typed.
 */
export function suggestAddresses(index: StreetIndex, text: string): AddressSuggestion[] {
  const query = parseAddressQuery(text);
  if (!query.words.length || query.streetLetters < MIN_STREET_LETTERS) return [];
  const candidates: Candidate[] = [];
  for (const row of index.streets) {
    const [name, type, localityIndex] = row;
    const locality = index.localities[localityIndex];
    if (!locality) continue;
    const streetWords = `${name} ${type}`.trim().toLowerCase().split(" ");
    const nameWordCount = name.split(" ").length;
    const match = matchWords(query.words, streetWords, nameWordCount, locality[0].toLowerCase());
    if (match === null) continue;
    const [suburb, state] = locality;
    const postcode = row.length > 3 ? (row[3] as string) : locality[2];
    const streetLabel = `${name}${type ? ` ${type}` : ""}`;
    candidates.push({
      suggestion: { number: query.number, street: name, streetType: type, suburb, state, postcode, label: `${query.number ? `${query.number} ` : ""}${streetLabel}, ${suburb} ${state} ${postcode}` },
      exactPrefix: match.start === 0,
      stateRank: state === "ACT" ? 0 : state === "NSW" ? 1 : 2,
      sortKey: `${streetLabel}\u0000${suburb}`.toLowerCase(),
    });
  }
  candidates.sort((a, b) => Number(b.exactPrefix) - Number(a.exactPrefix) || a.stateRank - b.stateRank || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return candidates.slice(0, MAX_SUGGESTIONS).map((c) => c.suggestion);
}

/**
 * Tries every split of the typed words into a street part (at least one word, consecutive word prefixes of
 * streetWords starting at some name word) and a suburb part (a prefix of the suburb name). Returns the start
 * word of the street match, or null.
 */
function matchWords(typed: string[], streetWords: string[], nameWordCount: number, suburb: string): { start: number } | null {
  for (let streetCount = typed.length; streetCount >= 1; streetCount--) {
    const suburbPart = typed.slice(streetCount).join(" ");
    if (suburbPart && !suburb.startsWith(suburbPart)) continue;
    for (let start = 0; start < nameWordCount; start++) {
      if (start + streetCount > streetWords.length) break;
      let ok = true;
      for (let i = 0; i < streetCount; i++) if (!streetWords[start + i].startsWith(typed[i])) { ok = false; break; }
      if (ok) return { start };
    }
  }
  return null;
}

/** True when `suburb` appears in the address text as a whole word (case-insensitive; multi-word suburbs as a phrase). */
export function addressContainsSuburb(text: string | null | undefined, suburb: string): boolean {
  const needle = suburb.trim();
  if (!needle || !text) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "i").test(text);
}

/** D7 in the form: after the text is edited, the picked parts stay only while the suburb is still a whole word of the text. */
export function partsAfterEdit(text: string, parts: AddressParts | null): AddressParts | null {
  if (!parts) return null;
  return addressContainsSuburb(text, parts.suburb) ? parts : null;
}

/**
 * Server-side shape check (D7): the three parts are all set or all null; suburb ≤ 60 characters, state one of
 * ADDRESS_STATES, postcode 4 digits, and the suburb must appear in the address text as a whole word.
 * Returns the normalised parts (trimmed, state upper-cased) or an error message. Needs no index.
 */
export function validateAddressParts(address: string | null, suburb: string | null, state: string | null, postcode: string | null): { ok: true; parts: AddressParts | null } | { ok: false; error: string } {
  const given = [suburb, state, postcode].filter((v) => v !== null && v !== "");
  if (given.length === 0) return { ok: true, parts: null };
  if (given.length !== 3) return { ok: false, error: "Address suburb, state and postcode go together: pick a suggestion or leave all three empty." };
  const trimmedSuburb = String(suburb).trim();
  const upperState = String(state).trim().toUpperCase();
  const trimmedPostcode = String(postcode).trim();
  if (!trimmedSuburb || trimmedSuburb.length > MAX_SUBURB_LENGTH) return { ok: false, error: `Address suburb must be 1 to ${MAX_SUBURB_LENGTH} characters.` };
  if (!(ADDRESS_STATES as readonly string[]).includes(upperState)) return { ok: false, error: `Address state must be one of ${ADDRESS_STATES.join(", ")}.` };
  if (!/^\d{4}$/.test(trimmedPostcode)) return { ok: false, error: "Address postcode must be 4 digits." };
  if (!addressContainsSuburb(address, trimmedSuburb)) return { ok: false, error: `The address text must contain the suburb "${trimmedSuburb}" (pick a suggestion again, or clear the suburb).` };
  return { ok: true, parts: { suburb: trimmedSuburb, state: upperState, postcode: trimmedPostcode } };
}
