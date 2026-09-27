// A minimal JSON Schema (draft 2020-12 subset) validator, sufficient for
// docs/integrations/lesson-upserted-v1.schema.json specifically — not a
// general-purpose library. Adapted from the equivalent validator ACTGDS
// runs in production against its own copy of this exact canonical schema
// (`tony-kunliu/actgds.com`'s `lib/instructor-assistant-contract.ts`,
// read-only reviewed as part of this round's alignment work) — reusing
// their already-proven logic here, test-only, rather than re-deriving a
// second interpretation of the same schema that could quietly drift from
// theirs. Never shipped as sender code; used only to prove this repo's
// generated payloads actually validate against the canonical schema file,
// not just that the file's hash matches.

type Rule = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Rule>;
  additionalProperties?: boolean;
  items?: Rule;
  uniqueItems?: boolean;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};

function validDate(value: string): boolean {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function matchesSchema(value: unknown, rule: Rule): boolean {
  if ("const" in rule && value !== rule.const) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const props = rule.properties ?? {};
    return (
      (rule.required ?? []).every((key) => Object.hasOwn(record, key)) &&
      Object.keys(record).every((key) => (Object.hasOwn(props, key) ? matchesSchema(record[key], props[key]) : rule.additionalProperties !== false))
    );
  }
  if (rule.type === "array") {
    return (
      Array.isArray(value) &&
      value.length <= (rule.maxItems ?? Infinity) &&
      (!rule.uniqueItems || new Set(value).size === value.length) &&
      value.every((item) => matchesSchema(item, rule.items!))
    );
  }
  if (rule.type === "integer" || rule.type === "number") {
    return typeof value === "number" && Number.isFinite(value) && (rule.type !== "integer" || Number.isInteger(value)) && value >= (rule.minimum ?? -Infinity) && value <= (rule.maximum ?? Infinity);
  }
  if (rule.type === "string") {
    if (typeof value !== "string" || value.length < (rule.minLength ?? 0) || value.length > (rule.maxLength ?? Infinity)) return false;
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
    if (rule.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;
    if (rule.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !validDate(value))) return false;
    if (rule.format === "date-time" && (!Number.isFinite(Date.parse(value)) || !validDate(value.slice(0, 10)))) return false;
  }
  return true;
}

/** The additional cross-array semantic rules the JSON Schema itself cannot express — mirrors ACTGDS's runtime `isLessonEvent()` check. */
export function matchesReceiverSemantics(payload: { lesson: { taught: string[]; assessed: string[]; achieved: string[] } }): boolean {
  const assessedSet = new Set(payload.lesson.assessed);
  return payload.lesson.achieved.every((id) => assessedSet.has(id)) && payload.lesson.taught.every((id) => !assessedSet.has(id));
}
