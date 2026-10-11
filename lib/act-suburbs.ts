// ACT suburb → district → accepted Competency 23 town centre (R10 design §2a, D3, D4).
//
// Static table from general knowledge of the ACT district structure, cross-checked
// 2026-10-11 against Wikipedia's "List of Canberra suburbs" (suburbs by district,
// retrieved from en.wikipedia.org in the build environment). It is NOT instrument
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
//     Molonglo Valley. The NSW suburb of the same name, Jerrabomberra, is in the
//     NSW list and wins when it is nearer the end of the address.
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
  | "hall";

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
    suburbs: ["Acton", "Ainslie", "Braddon", "Campbell", "City", "Civic", "Dickson", "Downer", "Hackett", "Lyneham", "O'Connor", "Reid", "Turner", "Watson"],
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
    suburbs: ["Chifley", "Curtin", "Farrer", "Garran", "Hughes", "Isaacs", "Lyons", "Mawson", "O'Malley", "Pearce", "Phillip", "Swinger Hill", "Torrens", "Woden"],
  },
  {
    id: "tuggeranong",
    name: "Tuggeranong",
    townCentreId: "tuggeranong",
    suburbs: ["Banks", "Bonython", "Calwell", "Chisholm", "Conder", "Fadden", "Gilmore", "Gordon", "Gowrie", "Greenway", "Isabella Plains", "Kambah", "Macarthur", "Monash", "Oxley", "Richardson", "Theodore", "Tuggeranong", "Wanniassa"],
  },
  { id: "weston-creek", name: "Weston Creek", townCentreId: null, suburbs: ["Chapman", "Duffy", "Fisher", "Holder", "Rivett", "Stirling", "Waramanga", "Weston"] },
  { id: "molonglo-valley", name: "Molonglo Valley", townCentreId: null, suburbs: ["Coombs", "Denman Prospect", "Whitlam", "Wright"] },
  { id: "jerrabomberra-act", name: "Jerrabomberra (ACT)", townCentreId: null, suburbs: ["Beard", "Hume", "Oaks Estate", "Symonston"] },
  { id: "majura", name: "Majura", townCentreId: null, suburbs: ["Pialligo"] },
  { id: "hall", name: "Hall", townCentreId: null, suburbs: ["Hall"] },
];

/** Local names that stand for a district in address text (Q2). Only unambiguous ones. */
export const DISTRICT_ALIASES: readonly { alias: string; districtId: DistrictId }[] = [
  { alias: "Belco", districtId: "belconnen" },
  { alias: "Tuggers", districtId: "tuggeranong" },
];

/** ACT places we recognise but deliberately do not map to a district (see the header). */
export const UNMAPPED_ACT_SUBURBS: readonly string[] = ["Fyshwick", "Russell", "Capital Hill", "Kinlyside", "Bandler", "Molonglo", "Sulman", "Canberra Airport"];

/** Nearby NSW places; an address naming one of them (or the token "NSW") is outside the ACT. */
export const NSW_PLACES: readonly string[] = ["Queanbeyan", "Queanbeyan East", "Queanbeyan West", "Jerrabomberra", "Googong", "Karabar", "Crestwood", "Greenleigh", "Murrumbateman", "Bungendore", "Sutton", "Yass", "Gundaroo", "Royalla", "Carwoola", "Wamboin", "Burra", "Tralee", "Environa", "Goulburn", "Braidwood", "Michelago", "Williamsdale"];

export type SuburbMatch =
  | { kind: "district"; district: District; matched: string }
  | { kind: "unmapped"; matched: string }
  | { kind: "outside-act"; matched: string }
  | { kind: "none" };

/** Lower-case, apostrophes removed (O'Connor = OConnor = O’Connor), every other non-letter run = one space. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type Candidate = { words: string[]; result: SuburbMatch };

let candidatesCache: Candidate[] | null = null;
function candidates(): Candidate[] {
  if (candidatesCache) return candidatesCache;
  const out: Candidate[] = [];
  for (const district of DISTRICTS) for (const suburb of district.suburbs) out.push({ words: tokens(suburb), result: { kind: "district", district, matched: suburb } });
  for (const { alias, districtId } of DISTRICT_ALIASES) {
    const district = DISTRICTS.find((d) => d.id === districtId)!;
    out.push({ words: tokens(alias), result: { kind: "district", district, matched: alias } });
  }
  for (const suburb of UNMAPPED_ACT_SUBURBS) out.push({ words: tokens(suburb), result: { kind: "unmapped", matched: suburb } });
  for (const place of NSW_PLACES) out.push({ words: tokens(place), result: { kind: "outside-act", matched: place } });
  candidatesCache = out;
  return out;
}

/**
 * The suburb named in a free-text address, whole-word and case-insensitive. When several names occur
 * (a street can be named after a suburb: "3 Gungahlin Dr, Florey"), the one whose match ends NEAREST
 * THE END of the address wins (D3: the suburb follows the street in Australian addresses); a longer
 * name wins a tie on the same end position ("Red Hill" over "Hill"). Pure; never guesses.
 */
export function matchSuburb(address: string | null | undefined): SuburbMatch {
  const words = tokens(address ?? "");
  if (!words.length) return { kind: "none" };
  let best: { end: number; length: number; result: SuburbMatch } | null = null;
  for (const candidate of candidates()) {
    const n = candidate.words.length;
    for (let start = words.length - n; start >= 0; start--) {
      let hit = true;
      for (let i = 0; i < n; i++) if (words[start + i] !== candidate.words[i]) { hit = false; break; }
      if (!hit) continue;
      const end = start + n;
      if (!best || end > best.end || (end === best.end && n > best.length)) best = { end, length: n, result: candidate.result };
      break; // the last occurrence of this candidate is found; earlier ones cannot be nearer the end
    }
  }
  // An explicit "NSW" anywhere puts the address outside the ACT, whatever else matched; a NSW place name is the better evidence.
  if (words.includes("nsw")) return { kind: "outside-act", matched: best?.result.kind === "outside-act" ? best.result.matched : "NSW" };
  return best ? best.result : { kind: "none" };
}
