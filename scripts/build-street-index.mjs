#!/usr/bin/env node
// Builds public/data/streets-<release>.json, the bundled street index for the learner Address
// suggestions (learner intake design 2026-10-11, Feature 1, D1/D2/D10). Dev-only: run by an agent
// about once a year (docs/BACKLOG.md), never in CI and never on the Worker.
//
// Source: Geoscape G-NAF on data.gov.au (CC BY 4.0 under the Open G-NAF EULA; this app sends no
// mail, so the EULA's mail-out use restriction does not apply). The current release is found through
// the data.gov.au CKAN API; only the needed PSV files are range-read out of the 1.85 GB national ZIP
// (HTTP Range + ZIP central directory), so nothing large is stored. Streets with no address, and
// retired streets/localities, are left out. House numbers are never part of the index (D4).
//
// Coverage (D2): every ACT street locality with at least one address, plus all streets of 11 NSW
// localities around Queanbeyan (NSW_LOCALITIES, Tony Q8). ACT postcodes are the most common postcode
// of the street's addresses; NSW postcodes come from NSW_POSTCODES and are re-checked against the NSW
// address details (the check can be skipped with --skip-nsw-check: the NSW address file is large).
//
// Usage:
//   node scripts/build-street-index.mjs [--list] [--skip-nsw-check] [--out public/data]
//   NODE_USE_ENV_PROXY=1 node scripts/build-street-index.mjs   # behind an HTTPS proxy (Node >= 22.21)
// Street names are never invented: if the data cannot be fetched the script stops with an error.

import { createInflateRaw } from "node:zlib";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

/** Australia Post street type abbreviations (AS 4590 / Australia Post Address Presentation Standards), title case; Tony Q9. */
const STREET_TYPE_ABBREVIATIONS = {
  ACCESS: "Accs", ALLEY: "Ally", ALLEYWAY: "Alwy", AMBLE: "Ambl", APPROACH: "App", ARCADE: "Arc", ARTERIAL: "Artl", AVENUE: "Av", BANAN: "Ba", BEND: "Bend",
  BOARDWALK: "Bwlk", BOULEVARD: "Bvd", BOULEVARDE: "Bvd", BRACE: "Br", BRAE: "Brae", BREAK: "Brk", BROW: "Brow", BYPASS: "Byp", BYWAY: "Bywy", CAUSEWAY: "Cswy",
  CENTRE: "Ctr", CENTREWAY: "Cnwy", CHASE: "Ch", CIRCLE: "Cir", CIRCLET: "Clt", CIRCUIT: "Cct", CIRCUS: "Crcs", CLOSE: "Cl", COLONNADE: "Clde", COMMON: "Cmmn",
  CONCOURSE: "Con", COPSE: "Cps", CORNER: "Cnr", CORSO: "Cso", COURT: "Ct", COURTYARD: "Ctyd", COVE: "Cove", CRESCENT: "Cres", CREST: "Crst", CROSS: "Crss",
  CROSSING: "Xing", CROSSROAD: "Crd", CROSSWAY: "Cowy", CRUISEWAY: "Cuwy", "CUL-DE-SAC": "Cds", CUTTING: "Cttg", DALE: "Dale", DELL: "Dell", DEVIATION: "Devn",
  DIP: "Dip", DISTRIBUTOR: "Dstr", DRIVE: "Dr", DRIVEWAY: "Drwy", EDGE: "Edge", ELBOW: "Elb", END: "End", ENTRANCE: "Ent", ESPLANADE: "Esp", ESTATE: "Est",
  EXPRESSWAY: "Exp", EXTENSION: "Extn", FAIRWAY: "Fawy", "FIRE TRACK": "Ftrk", FIRETRAIL: "Fitr", FLAT: "Flat", FOLLOW: "Folw", FOOTWAY: "Ftwy", FORESHORE: "Fshr",
  FORMATION: "Form", FREEWAY: "Fwy", FRONT: "Frnt", FRONTAGE: "Frtg", GAP: "Gap", GARDEN: "Gdn", GARDENS: "Gdns", GATE: "Gte", GATES: "Gte", GLADE: "Gld",
  GLEN: "Glen", GRANGE: "Gra", GREEN: "Grn", GROUND: "Grnd", GROVE: "Gr", GULLY: "Gly", HEIGHTS: "Hts", HIGHROAD: "Hrd", HIGHWAY: "Hwy", HILL: "Hill",
  INTERCHANGE: "Intg", INTERSECTION: "Intn", JUNCTION: "Jnc", KEY: "Key", LANDING: "Ldg", LANE: "Lane", LANEWAY: "Lnwy", LEES: "Lees", LINE: "Line", LINK: "Link",
  LITTLE: "Lt", LOOKOUT: "Lkt", LOOP: "Loop", LOWER: "Lwr", MALL: "Mall", MEANDER: "Mndr", MEW: "Mew", MEWS: "Mews", MOTORWAY: "Mwy", MOUNT: "Mt",
  NOOK: "Nook", OUTLOOK: "Otlk", PARADE: "Pde", PARK: "Park", PARKLANDS: "Pkld", PARKWAY: "Pwy", PART: "Part", PASS: "Pass", PATH: "Path", PATHWAY: "Phwy",
  PIAZZA: "Piaz", PLACE: "Pl", PLATEAU: "Plat", PLAZA: "Plza", POCKET: "Pkt", POINT: "Pt", PORT: "Port", PROMENADE: "Prom", QUAD: "Quad", QUADRANGLE: "Qdgl",
  QUADRANT: "Qdrt", QUAY: "Qy", QUAYS: "Qys", RAMBLE: "Rmbl", RAMP: "Ramp", RANGE: "Rnge", REACH: "Rch", RESERVE: "Res", REST: "Rest", RETREAT: "Rtt",
  RIDE: "Ride", RIDGE: "Rdge", RIDGEWAY: "Rgwy", "RIGHT OF WAY": "Rowy", RING: "Ring", RISE: "Rise", RIVER: "Rvr", RIVERWAY: "Rvwy", RIVIERA: "Rvra", ROAD: "Rd",
  ROADS: "Rds", ROADSIDE: "Rdsd", ROADWAY: "Rdwy", RONDE: "Ronde", ROSEBOWL: "Rsbl", ROTARY: "Rty", ROUND: "Rnd", ROUTE: "Rte", ROW: "Row", RUE: "Rue",
  RUN: "Run", "SERVICE WAY": "Swy", SIDING: "Sdng", SLOPE: "Slpe", SOUND: "Snd", SPUR: "Spur", SQUARE: "Sq", STAIRS: "Strs", "STATE HIGHWAY": "Shwy", STEPS: "Stps",
  STRAND: "Stra", STREET: "St", STRIP: "Strp", SUBWAY: "Sbwy", TARN: "Tarn", TERRACE: "Tce", THOROUGHFARE: "Thor", TOLLWAY: "Tlwy", TOP: "Top", TOR: "Tor",
  TOWERS: "Twrs", TRACK: "Trk", TRAIL: "Trl", TRAILER: "Trlr", TRIANGLE: "Tri", TRUNKWAY: "Tkwy", TURN: "Turn", UNDERPASS: "Upas", UPPER: "Upr", VALE: "Vale",
  VIADUCT: "Vdct", VIEW: "View", VILLAS: "Vlls", VISTA: "Vsta", WADE: "Wade", WALK: "Walk", WALKWAY: "Wkwy", WAY: "Way", WHARF: "Whrf", WYND: "Wynd", YARD: "Yard",
};

/** "APPLEFORD" → "Appleford"; "O'CONNOR" → "O'Connor"; "MOUNT MUGGA-MUGGA" → "Mount Mugga-Mugga"; "MCCOY" → "McCoy" (Mac is left alone: Macarthur vs MacGregor is not decidable). */
export function titleCase(upper) {
  return upper
    .toLowerCase()
    .replace(/(^|[\s\-'(])([a-z])/g, (_, before, letter) => before + letter.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, letter) => `Mc${letter.toUpperCase()}`);
}

const unknownTypes = new Set();
/** The Australia Post abbreviation of a G-NAF street type name; an unknown type keeps its full name in title case (never a guessed abbreviation). */
export function streetTypeAbbreviation(typeName) {
  const abbreviation = STREET_TYPE_ABBREVIATIONS[typeName.toUpperCase()];
  if (!abbreviation) unknownTypes.add(typeName);
  return abbreviation ?? titleCase(typeName);
}

const CKAN_PACKAGE = "https://data.gov.au/data/api/3/action/package_show?id=geocoded-national-address-file-g-naf";
const PACKAGE_PAGE = "https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf";

/** The 11 NSW localities (G-NAF LOCALITY_NAME, upper case) and their postcodes (D2; Tony Q8). */
export const NSW_POSTCODES = {
  QUEANBEYAN: "2620", "QUEANBEYAN EAST": "2620", "QUEANBEYAN WEST": "2620", KARABAR: "2620", CRESTWOOD: "2620",
  GREENLEIGH: "2620", "THE RIDGEWAY": "2620", JERRABOMBERRA: "2619", GOOGONG: "2620", TRALEE: "2620", ROYALLA: "2620",
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// ── HTTP range reading ───────────────────────────────────────────────────────

async function fetchOk(url, init) {
  const response = await fetch(url, init);
  if (!response.ok && response.status !== 206) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function contentLength(url) {
  const response = await fetchOk(url, { method: "HEAD" });
  const length = Number(response.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) throw new Error(`${url}: no content-length (range reading needs it)`);
  if (!/bytes/i.test(response.headers.get("accept-ranges") ?? "")) throw new Error(`${url}: server does not accept byte ranges`);
  return length;
}

async function rangeBuffer(url, start, end) {
  const response = await fetchOk(url, { headers: { range: `bytes=${start}-${end}` } });
  if (response.status !== 206) throw new Error(`${url}: range request answered ${response.status}, not 206`);
  return Buffer.from(await response.arrayBuffer());
}

// ── ZIP central directory (plain and ZIP64) ──────────────────────────────────

async function zipEntries(url) {
  const size = await contentLength(url);
  const tailStart = Math.max(0, size - 66_000);
  const tail = await rangeBuffer(url, tailStart, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP end-of-central-directory record not found");
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  let count = tail.readUInt16LE(eocd + 10);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw new Error("ZIP64 locator missing");
    const zip64At = Number(tail.readBigUInt64LE(locator + 8));
    const record = zip64At >= tailStart ? tail.subarray(zip64At - tailStart) : await rangeBuffer(url, zip64At, zip64At + 56 - 1);
    if (record.readUInt32LE(0) !== 0x06064b50) throw new Error("ZIP64 end-of-central-directory record missing");
    count = Number(record.readBigUInt64LE(32));
    cdSize = Number(record.readBigUInt64LE(40));
    cdOffset = Number(record.readBigUInt64LE(48));
  }
  const cd = cdOffset >= tailStart && cdOffset + cdSize <= size ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize) : await rangeBuffer(url, cdOffset, cdOffset + cdSize - 1);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let compressed = cd.readUInt32LE(p + 20);
    let uncompressed = cd.readUInt32LE(p + 24);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLength);
    const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extra.readUInt16LE(e);
      const length = extra.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let f = e + 4;
        if (uncompressed === 0xffffffff) { uncompressed = Number(extra.readBigUInt64LE(f)); f += 8; }
        if (compressed === 0xffffffff) { compressed = Number(extra.readBigUInt64LE(f)); f += 8; }
        if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(f)); f += 8; }
      }
      e += 4 + length;
    }
    entries.push({ name, method, compressed, uncompressed, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length !== count) throw new Error(`ZIP central directory: parsed ${entries.length} entries, expected ${count}`);
  return entries;
}

/** Streams the decompressed lines of one ZIP entry (range read of just that entry's bytes). */
async function* entryLines(url, entry) {
  const header = await rangeBuffer(url, entry.offset, entry.offset + 30 - 1);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.name}: local file header missing`);
  const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const response = await fetchOk(url, { headers: { range: `bytes=${dataStart}-${dataStart + entry.compressed - 1}` } });
  if (response.status !== 206) throw new Error(`${entry.name}: range request answered ${response.status}`);
  if (entry.method !== 8 && entry.method !== 0) throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
  const inflate = entry.method === 8 ? createInflateRaw() : null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let pending = "";
  const chunks = [];
  let done = false;
  let waiting = null;
  let failed = null;
  const push = (chunk) => { chunks.push(chunk); if (waiting) { waiting(); waiting = null; } };
  const finish = () => { done = true; if (waiting) { waiting(); waiting = null; } };
  if (inflate) {
    inflate.on("data", push);
    inflate.on("end", finish);
    inflate.on("error", (error) => { failed = error; finish(); });
  }
  (async () => {
    try {
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        if (inflate) {
          if (!inflate.write(Buffer.from(value))) await new Promise((resolve) => inflate.once("drain", resolve));
        } else push(Buffer.from(value));
      }
      if (inflate) inflate.end(); else finish();
    } catch (error) { failed = error; finish(); }
  })();
  for (;;) {
    while (chunks.length) {
      pending += decoder.decode(chunks.shift(), { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) yield line.replace(/\r$/, "");
    }
    if (failed) throw failed;
    if (done) break;
    await new Promise((resolve) => { waiting = resolve; });
  }
  pending += decoder.decode();
  if (pending) yield pending.replace(/\r$/, "");
}

/** PSV rows as objects keyed by the header line (upper-case column names). */
async function* psvRows(url, entry) {
  let columns = null;
  let n = 0;
  for await (const line of entryLines(url, entry)) {
    if (!line) continue;
    const cells = line.split("|");
    if (!columns) { columns = cells.map((c) => c.toUpperCase()); continue; }
    const row = {};
    columns.forEach((column, i) => { row[column] = cells[i] ?? ""; });
    if (++n % 500_000 === 0) process.stderr.write(`  ${entry.name.split("/").pop()}: ${n.toLocaleString()} rows\n`);
    yield row;
  }
}

// ── Build ────────────────────────────────────────────────────────────────────

async function currentRelease() {
  const response = await fetchOk(CKAN_PACKAGE);
  const { result } = await response.json();
  const zips = result.resources.filter((r) => /allstates.*gda2020.*\.zip$/i.test(r.url));
  if (zips.length !== 1) throw new Error(`expected one national GDA2020 ZIP resource, found ${zips.length}`);
  const [zip] = zips;
  const match = /g-naf_([a-z]{3}\d{2})_/i.exec(zip.url);
  if (!match) throw new Error(`cannot read the release from ${zip.url}`);
  const release = match[1].toLowerCase(); // e.g. aug26
  const label = zip.name.replace(/\s*-\s*Geoscape.*$/i, "").trim(); // e.g. "AUG 2026"
  return { url: zip.url, release, label, licence: result.license_title, modified: result.metadata_modified };
}

function mostCommon(counts) {
  let best = null;
  for (const [key, n] of counts) if (best === null || n > best[1] || (n === best[1] && key < best[0])) best = [key, n];
  return best?.[0] ?? null;
}

async function main() {
  const outDir = option("--out", "public/data");
  const { url, release, label, licence, modified } = await currentRelease();
  process.stderr.write(`G-NAF ${label} (${release}): ${url}\n`);
  const entries = await zipEntries(url);
  if (flag("--list")) { for (const e of entries) console.log(`${e.compressed}\t${e.uncompressed}\t${e.method}\t${e.name}`); return; }
  const entry = (pattern) => {
    const found = entries.filter((e) => pattern.test(e.name));
    if (found.length !== 1) throw new Error(`expected one ZIP entry matching ${pattern}, found ${found.map((e) => e.name).join(", ") || "none"}`);
    return found[0];
  };
  if (option("--dump", null)) { for await (const line of entryLines(url, entry(new RegExp(option("--dump"))))) console.log(line); return; }

  // Authority tables (CODE|NAME|DESCRIPTION). STREET_TYPE_AUT: CODE is the full word and NAME G-NAF's own short
  // form ("CRESCENT|CR|CR"); the Australia Post abbreviation comes from the full word. STREET_SUFFIX_AUT: CODE is
  // the short form and NAME the full word ("N|NORTH|NORTH").
  const streetTypeName = new Map();
  for await (const row of psvRows(url, entry(/STREET_TYPE_AUT_psv\.psv$/i))) streetTypeName.set(row.CODE, row.CODE);
  const suffixName = new Map();
  for await (const row of psvRows(url, entry(/STREET_SUFFIX_AUT_psv\.psv$/i))) suffixName.set(row.CODE, row.NAME || row.CODE);

  const localities = new Map(); // locality_pid → { name, state, keep }
  for (const [state, keep] of [["ACT", () => true], ["NSW", (name) => name in NSW_POSTCODES]]) {
    for await (const row of psvRows(url, entry(new RegExp(`Standard/${state}_LOCALITY_psv\\.psv$`)))) {
      if (row.DATE_RETIRED) continue;
      if (!keep(row.LOCALITY_NAME)) continue;
      localities.set(row.LOCALITY_PID, { name: row.LOCALITY_NAME, state, class: row.LOCALITY_CLASS_CODE });
    }
  }
  const nswFound = new Set([...localities.values()].filter((l) => l.state === "NSW").map((l) => l.name));
  for (const name of Object.keys(NSW_POSTCODES)) if (!nswFound.has(name)) throw new Error(`NSW locality ${name} not found in G-NAF`);

  const streets = new Map(); // street_locality_pid → { name, type, suffix, localityPid, postcodes: Map }
  for (const state of ["ACT", "NSW"]) {
    for await (const row of psvRows(url, entry(new RegExp(`Standard/${state}_STREET_LOCALITY_psv\\.psv$`)))) {
      if (row.DATE_RETIRED || !localities.has(row.LOCALITY_PID)) continue;
      if (/^(UNNAMED|UNKNOWN)$/i.test(row.STREET_NAME.trim())) continue; // G-NAF placeholder, not a street name
      streets.set(row.STREET_LOCALITY_PID, { name: row.STREET_NAME, type: row.STREET_TYPE_CODE, suffix: row.STREET_SUFFIX_CODE, localityPid: row.LOCALITY_PID, postcodes: new Map() });
    }
  }
  process.stderr.write(`candidates: ${localities.size} localities, ${streets.size} streets\n`);

  // Address details: count postcodes per street (ACT: the postcode; NSW: the check against NSW_POSTCODES).
  const states = flag("--skip-nsw-check") ? ["ACT"] : ["ACT", "NSW"];
  for (const state of states) {
    for await (const row of psvRows(url, entry(new RegExp(`Standard/${state}_ADDRESS_DETAIL_psv\\.psv$`)))) {
      if (row.DATE_RETIRED) continue;
      const street = streets.get(row.STREET_LOCALITY_PID);
      if (!street || !/^\d{4}$/.test(row.POSTCODE)) continue;
      street.postcodes.set(row.POSTCODE, (street.postcodes.get(row.POSTCODE) ?? 0) + 1);
    }
  }

  // Assemble: locality table (name, state, postcode) and street rows (name, type, locality index[, postcode when it differs]).
  const localityRows = new Map(); // key name|state|postcode → index
  const localityList = [];
  const streetRows = [];
  const localityPostcode = new Map(); // locality_pid → most common postcode across its streets
  for (const street of streets.values()) {
    const locality = localities.get(street.localityPid);
    if (locality.state === "ACT" && street.postcodes.size === 0) continue; // no address: not a usable street
    const counts = localityPostcode.get(street.localityPid) ?? new Map();
    for (const [postcode, n] of street.postcodes) counts.set(postcode, (counts.get(postcode) ?? 0) + n);
    localityPostcode.set(street.localityPid, counts);
  }
  const problems = [];
  for (const [pid, street] of streets) {
    const locality = localities.get(pid === undefined ? "" : street.localityPid);
    const defaultPostcode = locality.state === "NSW" ? NSW_POSTCODES[locality.name] : mostCommon(localityPostcode.get(street.localityPid) ?? new Map());
    if (locality.state === "ACT" && street.postcodes.size === 0) continue;
    if (!defaultPostcode) { problems.push(`${locality.name}: no postcode`); continue; }
    let postcode = locality.state === "NSW" ? defaultPostcode : mostCommon(street.postcodes);
    if (locality.state === "NSW" && street.postcodes.size && !street.postcodes.has(defaultPostcode)) {
      problems.push(`${street.name} ${street.type} ${locality.name} NSW: addresses say ${[...street.postcodes.keys()].join("/")}, table says ${defaultPostcode}`);
    }
    const key = `${locality.name}|${locality.state}|${defaultPostcode}`;
    if (!localityRows.has(key)) { localityRows.set(key, localityList.length); localityList.push([titleCase(locality.name), locality.state, defaultPostcode]); }
    const typeName = street.type ? streetTypeName.get(street.type) ?? street.type : "";
    const type = typeName ? streetTypeAbbreviation(typeName) : "";
    const suffix = street.suffix ? titleCase(suffixName.get(street.suffix) ?? street.suffix) : "";
    const row = [titleCase(street.name), suffix ? `${type} ${suffix}`.trim() : type, localityRows.get(key)];
    if (postcode !== defaultPostcode) row.push(postcode);
    streetRows.push(row);
  }
  if (problems.length) { for (const p of problems) process.stderr.write(`WARNING ${p}\n`); }
  if (unknownTypes.size) process.stderr.write(`WARNING street types without an Australia Post abbreviation (kept in full): ${[...unknownTypes].join(", ")}\n`);

  // Sort: localities by state (ACT first), then name; streets by name, type, locality.
  const order = localityList.map((_, i) => i).sort((a, b) => localityList[a][1].localeCompare(localityList[b][1]) || localityList[a][0].localeCompare(localityList[b][0]) || localityList[a][2].localeCompare(localityList[b][2]));
  const remap = new Map(order.map((old, fresh) => [old, fresh]));
  const sortedLocalities = order.map((i) => localityList[i]);
  for (const row of streetRows) row[2] = remap.get(row[2]);
  streetRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2] - b[2]);
  // Dedupe on what the user sees: "<name> <type>" + locality + postcode (G-NAF has e.g. "EMU BANK" with no type AND
  // "EMU" of type BANK in Belconnen; one row is enough). Sorted, so the first spelling wins.
  const unique = new Set();
  const deduped = streetRows.filter((row) => {
    const k = `${`${row[0]} ${row[1]}`.trim().toLowerCase()}|${row[2]}|${row[3] ?? sortedLocalities[row[2]][2]}`;
    if (unique.has(k)) return false;
    unique.add(k);
    return true;
  });

  const header = {
    source: `Geoscape G-NAF ${label} release (data.gov.au, ${PACKAGE_PAGE}), metadata modified ${modified.slice(0, 10)}`,
    release,
    licence: `${licence} (CC BY 4.0) under the Open G-NAF End User Licence Agreement; this app sends no mail, so the EULA's mail-out use restriction does not apply`,
    attribution: "Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.",
    coverage: `ACT street localities with at least one address, plus all streets of ${Object.keys(NSW_POSTCODES).length} NSW localities: ${Object.keys(NSW_POSTCODES).map(titleCase).join(", ")}. House numbers are not included and are never verified.`,
    built: new Date().toISOString().slice(0, 10),
    builder: "scripts/build-street-index.mjs",
    format: "localities: [name, state, postcode]; streets: [streetName, streetTypeAbbreviation, localityIndex, postcode?] (postcode only when it differs from the locality's)",
    entries: deduped.length,
    localities: sortedLocalities.length,
  };
  const json = JSON.stringify({ _: header, localities: sortedLocalities, streets: deduped });
  mkdirSync(outDir, { recursive: true });
  for (const old of readdirSync(outDir)) if (/^streets-.*\.json$/.test(old) && old !== `streets-${release}.json`) { unlinkSync(join(outDir, old)); process.stderr.write(`removed ${old}\n`); }
  const file = join(outDir, `streets-${release}.json`);
  writeFileSync(file, json);
  const act = deduped.filter((r) => sortedLocalities[r[2]][1] === "ACT").length;
  process.stderr.write(`wrote ${file}: ${deduped.length} entries (ACT ${act}, NSW ${deduped.length - act}), ${sortedLocalities.length} localities, ${json.length.toLocaleString()} bytes raw, ${gzipSync(json).length.toLocaleString()} bytes gzip\n`);
}

main().catch((error) => { process.stderr.write(`build-street-index: ${error.stack ?? error}\n`); process.exit(1); });
