// ACT suburb → district → accepted Competency 23 town centre (R10 design §2a, D3, D4).
//
// Static table from general knowledge of the ACT district structure, cross-checked
// 2026-10-11 against Wikipedia's "List of Canberra suburbs" (suburbs by district,
// retrieved from en.wikipedia.org in the build environment) and 2026-10-12 against
// the bundled G-NAF locality list (public/data/streets-aug26.json; a test asserts
// every ACT/NSW locality there is covered). The structured suburb/state picked
// from a G-NAF suggestion (intake P2, migration 0012) is read before the free text. It is NOT instrument
// text: "unfamiliar" is not defined in NI2020-703; Tony's school rule (2026-10-11)
// is that the accepted centre of the learner's HOME district is familiar.
//
// Only suburbs we are confident about are listed. Anything uncertain is left out
// (or put in UNMAPPED_ACT_SUBURBS) so the panel shows the grey "cannot check" line
// rather than a wrong answer. Uncertain points, for the record:
//   - Officially (Districts Act 2002) the inner suburbs form ONE district,
//     "Canberra Central". Because that district holds two accepted centres
//     (Civic; Manuka/Kingston), this table splits it into the usual halves
//     "North Canberra" and "South Canberra" so each half maps to its own
//     centre. The split follows common usage (ABS / Wikipedia groupings), not a
//     gazette.
//   - Fyshwick is in Canberra Central (south) and is itself an accepted centre;
//     mapping it to Manuka/Kingston would make Fyshwick "unfamiliar" for someone
//     who lives there, so it is left UNMAPPED (grey line, instructor decides).
//   - Swinger Hill is a locality inside Phillip (Woden Valley), not a gazetted
//     suburb; included because it appears in addresses.
//   - Russell and Capital Hill are non-residential; Kinlyside, Bandler, Molonglo
//     (the suburb) and Sulman are gazetted but not settled: all left out.
//   - Jerrabomberra (ACT district: Beard, Hume, Oaks Estate, Symonston), Majura
//     (Pialligo) and Hall have no accepted centre, like Weston Creek and the
//     Molonglo Valley. BY DESIGN a learner from Hume, Symonston or Oaks Estate
//     gets "no accepted centre: all 7 unfamiliar", so Fyshwick next door counts
//     as unfamiliar (the rule is the home DISTRICT, no neighbour; Tony
//     2026-10-11). The NSW suburb of the same name, Jerrabomberra, is in the
//     NSW list and is treated as outside the ACT.
//
// Matching (D3, hardened after two reviews): the suburb must form its own
// address segment at the END of the address: it starts a segment (after a
// comma / line break / the start) or follows a street number or street type,
// and is followed only by "ACT" / "A.C.T." / "Australian Capital Territory" /
// "Australia" / "Canberra" / "NSW" / a 4-digit postcode. Anything else after or
// before it (a street type: "Taylor St", "Page Pl", "Gungahlin Dr, Florey"; a
// person's name: "Mr Franklin", "c/- Franklin"; another state: "South
// Australia") gives no home. No match = grey line, never a guess.
// Weston Creek and the Molonglo Valley have NO accepted centre and no neighbouring
// centre counts as home (Tony 2026-10-11): all 7 centres are suggested.

import type { TownCentreId } from "./town-centres.ts";

export type DistrictId =
  | "belconnen"
  | "gungahlin"
  | "north-canberra"
  | "south-canberra"
  | "woden-valley"
  | "tuggeranong"
  | "weston-creek"
  | "molonglo-valley"
  | "jerrabomberra-act"
  | "majura"
  | "hall"
  | "rural-act";

export type District = { id: DistrictId; name: string; townCentreId: TownCentreId | null; suburbs: readonly string[] };

export const DISTRICTS: readonly District[] = [
  {
    id: "belconnen",
    name: "Belconnen",
    townCentreId: "belconnen",
    suburbs: ["Aranda", "Belconnen", "Bruce", "Charnwood", "Cook", "Dunlop", "Evatt", "Florey", "Flynn", "Fraser", "Giralang", "Hawker", "Higgins", "Holt", "Kaleen", "Latham", "Lawson", "Macgregor", "Macnamara", "Macquarie", "McKellar", "Melba", "Page", "Scullin", "Spence", "Strathnairn", "Weetangera"],
  },
  {
    id: "gungahlin",
    name: "Gungahlin",
    townCentreId: "gungahlin",
    suburbs: ["Amaroo", "Bonner", "Casey", "Crace", "Forde", "Franklin", "Gungahlin", "Harrison", "Jacka", "Kenny", "Mitchell", "Moncrieff", "Ngunnawal", "Nicholls", "Palmerston", "Taylor", "Throsby"],
  },
  {
    id: "north-canberra",
    name: "North Canberra",
    townCentreId: "civic",
    suburbs: ["Acton", "Ainslie", "Braddon", "Campbell", "Canberra City", "City", "Civic", "Dickson", "Downer", "Hackett", "Lyneham", "O'Connor", "Reid", "Turner", "Watson"],
  },
  {
    id: "south-canberra",
    name: "South Canberra",
    townCentreId: "manuka-kingston",
    suburbs: ["Barton", "Deakin", "Forrest", "Griffith", "Kingston", "Manuka", "Narrabundah", "Parkes", "Red Hill", "Yarralumla"],
  },
  {
    id: "woden-valley",
    name: "Woden Valley",
    townCentreId: "woden",
    suburbs: ["Chifley", "Curtin", "Farrer", "Garran", "Hughes", "Isaacs", "Lyons", "Mawson", "O'Malley", "Pearce", "Phillip", "Swinger Hill", "Torrens", "Woden", "Woden Valley"],
  },
  {
    id: "tuggeranong",
    name: "Tuggeranong",
    townCentreId: "tuggeranong",
    suburbs: ["Banks", "Bonython", "Calwell", "Chisholm", "Conder", "Fadden", "Gilmore", "Gordon", "Gowrie", "Greenway", "Isabella Plains", "Kambah", "Macarthur", "Monash", "Oxley", "Richardson", "Theodore", "Tuggeranong", "Wanniassa"],
  },
  // G-NAF (public/data/streets-aug26.json) also lists the district names themselves as localities ("Weston Creek", "Molonglo Valley", "Majura").
  { id: "weston-creek", name: "Weston Creek", townCentreId: null, suburbs: ["Chapman", "Duffy", "Fisher", "Holder", "Rivett", "Stirling", "Waramanga", "Weston", "Weston Creek"] },
  { id: "molonglo-valley", name: "Molonglo Valley", townCentreId: null, suburbs: ["Coombs", "Denman Prospect", "Molonglo Valley", "Stromlo", "Whitlam", "Wright"] },
  { id: "jerrabomberra-act", name: "Jerrabomberra (ACT)", townCentreId: null, suburbs: ["Beard", "Hume", "Oaks Estate", "Symonston"] },
  { id: "majura", name: "Majura", townCentreId: null, suburbs: ["Majura", "Pialligo"] },
  { id: "hall", name: "Hall", townCentreId: null, suburbs: ["Hall"] },
  // Rural ACT localities in G-NAF (no accepted centre, like Weston Creek): the rule gives all 7 centres.
  { id: "rural-act", name: "the rural ACT", townCentreId: null, suburbs: ["Booth", "Coree", "Cotter River", "Kowen", "Paddys River", "Rendezvous Creek", "Tennent", "Tharwa", "Uriarra Village"] },
];

/**
 * ACT localities whose name is ALSO a NSW place (G-NAF lists "Jerrabomberra ACT 2600" next to Jerrabomberra NSW). Used only
 * when the learner's structured address says ACT; free text keeps treating the bare name as NSW (the far likelier home).
 */
export const ACT_ONLY_LOCALITIES: readonly { name: string; districtId: DistrictId }[] = [{ name: "Jerrabomberra", districtId: "jerrabomberra-act" }];

/** Local names that stand for a district in address text (Q2). Only unambiguous ones. */
export const DISTRICT_ALIASES: readonly { alias: string; districtId: DistrictId }[] = [
  { alias: "Belco", districtId: "belconnen" },
  { alias: "Tuggers", districtId: "tuggeranong" },
];

/** ACT places we recognise but deliberately do not map to a district (see the header). */
export const UNMAPPED_ACT_SUBURBS: readonly string[] = ["Fyshwick", "Russell", "Capital Hill", "Kinlyside", "Bandler", "Molonglo", "Sulman", "Canberra Airport", "Canberra Central"];

/** Nearby NSW places; an address naming one of them (or the token "NSW") is outside the ACT. */
export const NSW_PLACES: readonly string[] = ["Queanbeyan", "Queanbeyan East", "Queanbeyan West", "Jerrabomberra", "Googong", "Karabar", "Crestwood", "Greenleigh", "The Ridgeway", "Murrumbateman", "Bungendore", "Sutton", "Yass", "Gundaroo", "Royalla", "Carwoola", "Wamboin", "Burra", "Tralee", "Environa", "Goulburn", "Braidwood", "Michelago", "Williamsdale"];

/**
 * Lookup by the STRUCTURED suburb + state (learner intake P2, migration 0012: set only when a G-NAF street suggestion
 * was picked, so the suburb is a real locality name). Any state but ACT is outside the ACT. An ACT locality not in the
 * table is "unmapped" (grey line), never a guess.
 */
export function matchStructured(suburb: string, state: string): SuburbMatch {
  const name = suburb.trim();
  if (!name) return { kind: "none" };
  if (state.trim().toUpperCase() !== "ACT") return { kind: "outside-act", matched: name };
  const key = name.toLowerCase().replace(/['’`]/g, "");
  const same = (candidate: string) => candidate.toLowerCase().replace(/['’`]/g, "") === key;
  for (const district of DISTRICTS) {
    const hit = district.suburbs.find(same);
    if (hit) return { kind: "district", district, matched: hit };
  }
  const only = ACT_ONLY_LOCALITIES.find((entry) => same(entry.name));
  if (only) return { kind: "district", district: DISTRICTS.find((d) => d.id === only.districtId)!, matched: only.name };
  const alias = DISTRICT_ALIASES.find((entry) => same(entry.alias));
  if (alias) return { kind: "district", district: DISTRICTS.find((d) => d.id === alias.districtId)!, matched: alias.alias };
  return { kind: "unmapped", matched: UNMAPPED_ACT_SUBURBS.find(same) ?? name };
}

export type SuburbMatch =
  | { kind: "district"; district: District; matched: string }
  | { kind: "unmapped"; matched: string }
  | { kind: "outside-act"; matched: string }
  | { kind: "none" };

type Token = { word: string; /** A comma, semicolon or line break (or the start of the text) comes right before this token. */ segmentStart: boolean };

/** Lower-case word tokens with whether each starts an address segment. Apostrophes are dropped (O'Connor = OConnor = O’Connor). */
function tokenize(text: string): Token[] {
  const lower = text.toLowerCase().replace(/['’`]/g, "");
  const out: Token[] = [];
  let lastEnd = 0;
  for (const match of lower.matchAll(/[a-z0-9]+/g)) {
    const between = lower.slice(lastEnd, match.index);
    out.push({ word: match[0], segmentStart: out.length === 0 || /[,;\n]/.test(between) });
    lastEnd = match.index + match[0].length;
  }
  return out;
}
const words = (name: string) => tokenize(name).map((t) => t.word);

/** Tokens allowed AFTER the suburb: ACT / A.C.T. / Australian Capital Territory / Australia / Canberra / NSW / a 4-digit postcode (also "act2617"). */
const TAIL_WORDS = new Set(["act", "a", "c", "t", "australia", "canberra", "nsw"]);
const isTailToken = (word: string) => TAIL_WORDS.has(word) || /^\d{4}$/.test(word) || /^act\d{4}$/.test(word);
/** "Australian Capital Territory" is accepted only as that exact sequence (never "Capital" or "Territory" alone). */
function tailOk(rest: readonly string[]): boolean {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "australian" && rest[i + 1] === "capital" && rest[i + 2] === "territory") { i += 2; continue; }
    if (!isTailToken(rest[i])) return false;
  }
  return true;
}

/** Street types that may end the segment BEFORE the suburb ("12 Smith St Kaleen"). */
const STREET_TYPES = new Set(["st", "street", "rd", "road", "ave", "av", "avenue", "pl", "place", "dr", "drive", "cres", "crescent", "cct", "circuit", "ct", "court", "cl", "close", "la", "lane", "pde", "parade", "tce", "terrace", "way", "gr", "grove", "hwy", "highway", "bvd", "blvd", "boulevard", "esp", "esplanade", "sq", "square", "rise", "view", "vista", "walk", "loop", "link", "bend", "mews", "row", "gdns", "gardens", "pkwy", "parkway", "trk", "track", "ally", "alley", "path", "ridge", "cir", "circle", "ring", "cove", "glen", "heights", "hts", "brace", "chase", "tor", "promenade", "prom", "strip"]);

type Candidate = { words: string[]; result: SuburbMatch };

let candidatesCache: Candidate[] | null = null;
function candidates(): Candidate[] {
  if (candidatesCache) return candidatesCache;
  const out: Candidate[] = [];
  // Names with an apostrophe match both ways: "OConnor" and "O Connor".
  const forms = (name: string) => (/['’]/.test(name) ? [words(name), words(name.replace(/['’]/g, " "))] : [words(name)]);
  const add = (name: string, result: SuburbMatch) => { for (const w of forms(name)) out.push({ words: w, result }); };
  for (const district of DISTRICTS) for (const suburb of district.suburbs) add(suburb, { kind: "district", district, matched: suburb });
  for (const { alias, districtId } of DISTRICT_ALIASES) add(alias, { kind: "district", district: DISTRICTS.find((d) => d.id === districtId)!, matched: alias });
  for (const suburb of UNMAPPED_ACT_SUBURBS) add(suburb, { kind: "unmapped", matched: suburb });
  for (const place of NSW_PLACES) add(place, { kind: "outside-act", matched: place });
  candidatesCache = out;
  return out;
}

/**
 * The suburb named in a free-text address, whole-word and case-insensitive, accepted only when it forms its own
 * address segment at the END of the address: it starts a segment (after a comma / line break / the start) or follows a
 * street number or street type, and is followed only by state / country / postcode tokens. A suburb word inside a
 * street name ("3 Gungahlin Dr, Florey" → Florey; "12 Taylor St" → no match) or a person's name ("Mr Franklin",
 * "c/- Franklin") never counts. When two candidates qualify the one ending nearer the end wins, a longer name winning
 * a tie ("Red Hill" over "Hill"). A trailing "NSW" state token makes the address outside the ACT. Pure; never guesses.
 */
export function matchSuburb(address: string | null | undefined): SuburbMatch {
  const tokens = tokenize(address ?? "");
  if (!tokens.length) return { kind: "none" };
  const all = tokens.map((t) => t.word);
  let best: { end: number; length: number; result: SuburbMatch } | null = null;
  for (const candidate of candidates()) {
    const n = candidate.words.length;
    for (let start = all.length - n; start >= 0; start--) {
      let hit = true;
      for (let i = 0; i < n; i++) if (all[start + i] !== candidate.words[i]) { hit = false; break; }
      if (!hit) continue;
      const end = start + n;
      const before = start === 0 ? null : all[start - 1];
      const ownSegment = tokens[start].segmentStart || before === null || /^\d/.test(before) || STREET_TYPES.has(before);
      if (!ownSegment || !tailOk(all.slice(end))) break; // part of a street or person's name, or followed by other text
      if (!best || end > best.end || (end === best.end && n > best.length)) best = { end, length: n, result: candidate.result };
      break; // the last occurrence of this candidate is found; earlier ones cannot be nearer the end
    }
  }
  // The trailing state tokens: a "NSW" there puts the address outside the ACT, whatever suburb matched ("12 Nsw St, Florey" is Florey).
  let tailStart = all.length;
  while (tailStart > 0 && isTailToken(all[tailStart - 1])) tailStart--;
  if (all.slice(tailStart).includes("nsw")) return { kind: "outside-act", matched: best?.result.kind === "outside-act" ? best.result.matched : "NSW" };
  return best ? best.result : { kind: "none" };
}
