import type { Instructor } from "./types.ts";

/** Picker display names, keyed by login email. Display only: stored full_name (CSV `instructor` column, PDF) is unchanged. */
const PICKER_NAMES: Record<string, string> = {
  "kunliu.work@gmail.com": "Tony/Kun Liu",
  "yapingqu.work@gmail.com": "Anna/Yaping Qu",
};

export function instructorLabel(instructor: Pick<Instructor, "fullName" | "email" | "adiNumber">): string {
  const name = PICKER_NAMES[(instructor.email ?? "").trim().toLowerCase()];
  if (!name) return instructor.fullName;
  const adi = (instructor.adiNumber ?? "").trim().replace(/^ADI\s*/i, "");
  return adi ? `${name} (ADI${adi})` : name;
}
