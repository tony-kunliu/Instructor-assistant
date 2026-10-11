// The 7 accepted Town Centres for Competency 23 (R10 design D2).
//
// Source: NI2020-703 (ACT Assessment Standards 2020), Schedule 1, Competency 23,
// PDF p 37: "The accepted Town Centres are: Canberra City (Civic); Gungahlin;
// Belconnen; Woden; Tuggeranong; Fyshwick; Manuka and Kingston – together." and
// the "RTA - Accepted Town Centres" street table on the same page. The street
// lists are kept VERBATIM, including the instrument's spelling ("Gunghalin Dr",
// "Athllon Dr") and its repeats (Emu Bank, Anketell St, Newcastle St); no
// geometry is derived from them (that is P4 GPS). Static, no network, no maps.

export type TownCentreId = "civic" | "gungahlin" | "belconnen" | "woden" | "tuggeranong" | "fyshwick" | "manuka-kingston";

export type TownCentre = {
  id: TownCentreId;
  /** Short display name, as the chips and the generated comment line print it. */
  name: string;
  /** The instrument's own wording. */
  official: string;
  /** Boundary streets as printed on p 37 (Manuka and Kingston: both rows). */
  streetsAsPrinted: readonly string[];
  /** Local names Tony's instructors may type (Q2). Matched whole-word, case-insensitive. */
  aliases: readonly string[];
};

export const TOWN_CENTRES: readonly TownCentre[] = [
  {
    id: "civic",
    name: "Civic",
    official: "Canberra City (Civic)",
    streetsAsPrinted: ["Barry Dr", "Marcus Clarke St", "Edinburgh Ave", "London Cct", "Constitution Ave", "Coranderrk St / Cooyong St"],
    aliases: ["Canberra City", "City", "the City"],
  },
  {
    id: "gungahlin",
    name: "Gungahlin",
    official: "Gungahlin",
    streetsAsPrinted: ["Gunghalin Dr", "The Valley Ave", "Kate Crace St / Tesselaar St", "Swain St", "Pallin St", "Gundaroo Dr"],
    aliases: [],
  },
  {
    id: "belconnen",
    name: "Belconnen",
    official: "Belconnen",
    streetsAsPrinted: ["Coulter Dr", "Nettlefold St (including Courts off Nettlefold)", "College St", "Eastern Valley Way", "Emu Bank", "Bissell St", "Joynton Smith Dr", "Emu Bank", "Luxton St"],
    aliases: ["Belco"],
  },
  {
    id: "woden",
    name: "Woden",
    official: "Woden",
    streetsAsPrinted: ["Melrose Dr", "Launceston St", "Callam St", "Hindmarsh Dr"],
    aliases: [],
  },
  {
    id: "tuggeranong",
    name: "Tuggeranong",
    official: "Tuggeranong",
    streetsAsPrinted: ["Athllon Dr", "Anketell St", "Colishaw St", "North Reed St / South Reed St", "Anketell St"],
    aliases: ["Tuggers"],
  },
  {
    id: "fyshwick",
    name: "Fyshwick",
    official: "Fyshwick",
    streetsAsPrinted: ["Canberra Ave", "Newcastle St", "Collie St / Tennant St", "Gladstone St", "Newcastle St", "Ipswich St"],
    aliases: [],
  },
  {
    id: "manuka-kingston",
    name: "Manuka/Kingston",
    official: "Manuka and Kingston – together",
    streetsAsPrinted: ["Canberra Ave", "Captain Cook Cres", "Murray St", "Furneaux St", "Eyre St", "Jardine St", "Giles St", "Kennedy St"],
    aliases: ["Manuka", "Kingston", "Manuka and Kingston"],
  },
];

export function townCentre(id: TownCentreId): TownCentre {
  const found = TOWN_CENTRES.find((centre) => centre.id === id);
  if (!found) throw new Error(`Unknown town centre: ${id}`);
  return found;
}

/** The centre whose short name is exactly `name` (case-insensitive), or null. Used to parse the generated comment line. */
export function townCentreByName(name: string): TownCentre | null {
  const wanted = name.trim().toLowerCase();
  return TOWN_CENTRES.find((centre) => centre.name.toLowerCase() === wanted) ?? null;
}
