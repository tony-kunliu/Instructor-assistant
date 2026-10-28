// SaaS edition P1 (spec 2026-10-21-saas-edition-design §4, §5, §7, §10): the middleware gate as a pure function on a
// real SaaS D1 (openSaasTestD1). Onboarding, inactive accounts, the free trial boundary, and the route guard: every
// learner-keyed path with another tenant's learner id is 404 (never 403), as are transfer, another instructor's
// PATCH and /gps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { openSaasTestD1 } from "./helpers/saas-d1.ts";
import { accessIssuer, accessJwks, accessTeamDomain, verifyAccessIdentity } from "../lib/access.ts";
import { createLearner, createLesson, getOwnAdiSignature, listUnsignedLessons, setOwnAdiSignature } from "../lib/repo.ts";
import { createSaasInstructor } from "../lib/saas/accounts.ts";
import { parseTrialDays, saasGate, trialEndsAt, type GateResult } from "../lib/saas/gate.ts";

const CREATED = "2026-01-01T00:00:00.000Z";
const DAY_10 = new Date("2026-01-10T12:00:00.000Z");
const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";

async function setup() {
  const db = openSaasTestD1();
  const a = await createSaasInstructor(db, { email: "a@x.test", fullName: "QA Coach A", adiNumber: "ADI A" });
  const b = await createSaasInstructor(db, { email: "b@x.test", fullName: "QA Coach B", adiNumber: "ADI B" });
  await db.prepare("UPDATE instructors SET created_at = ?").bind(CREATED).run();
  const la = await createLearner(db, { fullName: "QA Learner A", instructorId: a.id });
  const lb = await createLearner(db, { fullName: "QA Learner B", instructorId: b.id });
  const lesson = (learnerId: string) =>
    createLesson(db, learnerId, { lessonDate: "2026-01-05", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], signLater: true });
  const lessonA = await lesson(la.id);
  const lessonB = await lesson(lb.id);
  return { db, a, b, la: la.id, lb: lb.id, lessonA: lessonA.id, lessonB: lessonB.id };
}

type Db = ReturnType<typeof openSaasTestD1>;
const gate = (db: Db, email: string, method: string, pathname: string, now = DAY_10, trialDays = 30) =>
  saasGate(db, { email, method, pathname, now, trialDays });
const PASS_ANON: GateResult = { kind: "pass" };
const NOT_FOUND: GateResult = { kind: "error", status: 404, error: "not_found" };

test("onboarding: a verified e-mail with no instructor is sent to /welcome; only the allow-list passes", async () => {
  const { db } = await setup();
  const who = "new@x.test";
  assert.deepEqual(await gate(db, who, "GET", "/"), { kind: "redirect", to: "/welcome" });
  assert.deepEqual(await gate(db, who, "GET", "/account"), { kind: "redirect", to: "/welcome" });
  for (const path of ["/welcome", "/welcome/", "/terms", "/privacy", "/disabled", "/manifest.webmanifest", "/icon.svg", "/icon.png", "/favicon.ico", "/data/x.json", "/data/streets-aug26.json", "/fonts/NotoSansSC-Subset.otf", "/pdf-template/adi-cbta-checklist.pdf"]) {
    assert.deepEqual(await gate(db, who, "GET", path), PASS_ANON, path);
  }
  assert.deepEqual(await gate(db, who, "POST", "/api/welcome"), PASS_ANON);
  assert.deepEqual(await gate(db, who, "GET", "/api/me"), PASS_ANON);
  const onboarding: GateResult = { kind: "error", status: 403, error: "onboarding_required" };
  for (const [method, path] of [["GET", "/api/learners"], ["POST", "/api/learners"], ["GET", "/api/me/signature"], ["GET", "/api/welcome"], ["GET", "/api/unsigned-lessons"], ["GET", "/api/instructors"], ["GET", "/API/learners"]]) {
    assert.deepEqual(await gate(db, who, method, path), onboarding, `${method} ${path}`);
  }
  // The allow-list is exact: lookalikes are not static assets.
  for (const path of ["/data", "/datax/y", "/welcome/x", "/icon.svg/x"]) assert.deepEqual(await gate(db, who, "GET", path), { kind: "redirect", to: "/welcome" }, path);
});

test("inactive instructor: pages go to /disabled, API is 403 account_disabled, never /welcome", async () => {
  const { db, a } = await setup();
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE id = ?").bind(a.id).run();
  assert.deepEqual(await gate(db, "A@X.TEST", "GET", "/"), { kind: "redirect", to: "/disabled" });
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/welcome"), { kind: "redirect", to: "/disabled" });
  for (const path of ["/disabled", "/terms", "/privacy", "/manifest.webmanifest", "/icon.svg", "/data/x.json"]) {
    assert.deepEqual(await gate(db, "a@x.test", "GET", path), PASS_ANON, path);
  }
  const disabled: GateResult = { kind: "error", status: 403, error: "account_disabled" };
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/api/learners"), disabled);
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/api/me"), disabled);
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/welcome"), disabled);
});

test("active instructor passes with the trusted instructor; the e-mail match is case-insensitive", async () => {
  const { db, a } = await setup();
  assert.deepEqual(await gate(db, "A@X.Test", "GET", "/"), { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } });
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/api/me"), { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } });
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/welcome"), { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } }, "an onboarded instructor's repeat submit reaches the route");
  assert.deepEqual(await gate(db, "", "GET", "/"), { kind: "error", status: 403, error: "identity_required" });
});

test("trial: writes allowed until created + 30 x 24 h exactly; then non-GET /api is 402; GET and /api/welcome still pass", async () => {
  const { db, a, la } = await setup();
  const pass = { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } };
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/learners", new Date("2026-01-30T23:59:59.999Z")), pass);
  const expired: GateResult = { kind: "error", status: 402, error: "trial_expired" };
  const end = new Date("2026-01-31T00:00:00.000Z");
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/learners", end), expired);
  const day40 = new Date("2026-02-10T00:00:00.000Z");
  for (const [method, path] of [["PATCH", `/api/learners/${la}`], ["PUT", "/api/me/signature"], ["DELETE", `/api/learners/${la}`], ["POST", `/api/learners/${la}/lessons`]]) {
    assert.deepEqual(await gate(db, "a@x.test", method, path, day40), expired, `${method} ${path}`);
  }
  assert.deepEqual(await gate(db, "a@x.test", "GET", `/api/learners/${la}/export`, day40), pass);
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/api/learners", day40), pass);
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/welcome", day40), pass);
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/", day40), pass, "pages are not /api writes");
  // A different trial length moves the boundary.
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/learners", new Date("2026-01-07T23:59:59.999Z"), 7), pass);
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/learners", new Date("2026-01-08T00:00:00.000Z"), 7), expired);
});

test("trial: an unparseable created_at fails closed (writes blocked)", async () => {
  const { db, a } = await setup();
  await db.prepare("UPDATE instructors SET created_at = 'garbage' WHERE id = ?").bind(a.id).run();
  assert.deepEqual(await gate(db, "a@x.test", "POST", "/api/learners"), { kind: "error", status: 402, error: "trial_expired" });
  assert.equal(trialEndsAt("garbage", 30), null);
  assert.equal(trialEndsAt(CREATED, 30), "2026-01-31T00:00:00.000Z");
});

test("parseTrialDays: positive integer, default 30, anything invalid is 30", () => {
  assert.equal(parseTrialDays(undefined), 30);
  assert.equal(parseTrialDays("14"), 14);
  assert.equal(parseTrialDays(" 7 "), 7);
  for (const bad of ["", "0", "-3", "1.5", "abc", "30days", "1e3", null, 12]) assert.equal(parseTrialDays(bad), 30, String(bad));
});

test("route guard: every learner-keyed path with another tenant's learner id is 404; own learner passes", async () => {
  const { db, a, la, lb, lessonA, lessonB } = await setup();
  const pass = { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } };
  const paths = (learner: string, lesson: string): [string, string][] => [
    ["GET", `/api/learners/${learner}`], ["PATCH", `/api/learners/${learner}`],
    ["GET", `/api/learners/${learner}/lessons/${lesson}`], ["PATCH", `/api/learners/${learner}/lessons/${lesson}`],
    ["POST", `/api/learners/${learner}/lessons/${lesson}/sign`],
    ["GET", `/api/learners/${learner}/import-draft`], ["PUT", `/api/learners/${learner}/import-draft`],
    ["POST", `/api/learners/${learner}/lessons`], ["GET", `/api/learners/${learner}/export`], ["POST", `/api/learners/${learner}/import`],
    ["GET", `/api/learners/${learner}/lessons/${lesson}/revisions`], ["GET", `/api/learners/${learner}/archive-history`],
    ["GET", `/api/learners/${learner}/`], ["GET", `/api/learners/${learner}/future-nested/route`],
  ];
  for (const [method, path] of paths(lb, lessonB)) assert.deepEqual(await gate(db, "a@x.test", method, path), NOT_FOUND, `${method} ${path}`);
  // A's learner with B's lesson id passes the guard: the handlers pair the lesson with its learner (P0) and 404 it there.
  for (const [method, path] of paths(la, lessonA)) assert.deepEqual(await gate(db, "a@x.test", method, path), pass, `${method} ${path}`);
  for (const path of ["/api/learners", "/api/learners/", "/api/instructors", "/api/instructors/", "/api/unsigned-lessons", "/api/me", "/api/me/signature"]) {
    assert.deepEqual(await gate(db, "a@x.test", "GET", path), pass, path);
  }
});

test("route guard: unknown, encoded, uppercase, dot-segment and malformed ids are 404", async () => {
  const { db, a, la, lb } = await setup();
  const pass = { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } };
  for (const path of [
    "/api/learners/%2e%2e/x", "/api/learners/../x", "/api/learners/./x", "/api/learners/%2E%2E", "/api/learners/unknown-id",
    `/api/learners/${la.toUpperCase()}`, `/api/learners/${encodeURIComponent(lb)}`, `/api/learners/${lb.replace(/^./, (c) => `%${c.charCodeAt(0).toString(16)}`)}/export`,
    "/api/learners/%E0%A4%A", `/api/learners/${la}/%E0%A4%A`, `/api/learners/${la}%2F..%2F${lb}`, `/api/learners/${la}/..%2F..%2Flearners%2F${lb}`,
    "/api/learners//x", `/api/learners//${lb}`, `/api//learners/${lb}/export`, `/api%2Flearners/${lb}`, `/API/Learners/${lb}`, `/api/learners/${la}%00`,
    `/api/learners/%25${la.slice(1)}`,
  ]) {
    assert.deepEqual(await gate(db, "a@x.test", "GET", path), NOT_FOUND, path);
  }
  // A percent-encoded form of A's own id is the same learner and passes (Next decodes the param the same way).
  const encodedOwn = la.replace(/^./, (c) => `%${c.charCodeAt(0).toString(16)}`);
  assert.deepEqual(await gate(db, "a@x.test", "GET", `/api/learners/${encodedOwn}/export`), pass);
  assert.deepEqual(await gate(db, "a@x.test", "GET", `/api//learners/${la}`), pass, "repeated slashes are collapsed before the check");
});

test("route guard: transfer, another instructor's record and /gps are 404 in saas; PATCH of oneself passes", async () => {
  const { db, a, b, la } = await setup();
  const pass = { kind: "pass", instructor: { id: a.id, fullName: "QA Coach A" } };
  for (const [method, path] of [
    ["POST", `/api/learners/${la}/transfer`], ["POST", `/api/learners/${la}/transfer/checked`], ["POST", `/api/learners/${la}/Transfer`],
    ["POST", `/api/learners/${la}/transfer/`], ["POST", `/api/learners/${la}/%74ransfer`],
    ["PATCH", `/api/instructors/${b.id}`], ["GET", `/api/instructors/${b.id}`], ["PATCH", `/api/instructors/${a.id.toUpperCase()}`], ["PATCH", `/api/instructors/${a.id}/x`],
    ["PATCH", "/api/instructors/%E0%A4%A"],
    ["GET", "/gps"], ["GET", "/gps/"], ["GET", "/gps/anything"], ["GET", "/GPS"],
  ]) {
    assert.deepEqual(await gate(db, "a@x.test", method, path), NOT_FOUND, `${method} ${path}`);
  }
  assert.deepEqual(await gate(db, "a@x.test", "PATCH", `/api/instructors/${a.id}`), pass);
  assert.deepEqual(await gate(db, "a@x.test", "PATCH", `/api/instructors/${a.id}/`), pass);
  assert.deepEqual(await gate(db, "a@x.test", "GET", "/gpsx"), pass, "only the /gps page tree is blocked");
});

test("route guard runs before the trial check: another tenant's learner is 404 even after the trial", async () => {
  const { db, lb } = await setup();
  assert.deepEqual(await gate(db, "a@x.test", "POST", `/api/learners/${lb}/lessons`, new Date("2026-03-01T00:00:00.000Z")), NOT_FOUND);
});

test("own-scope endpoints: unsigned lessons and the saved signature use only the trusted instructor id", async () => {
  const { db, a, b, lessonA } = await setup();
  assert.deepEqual((await listUnsignedLessons(db, a.id)).map((l) => l.lessonId), [lessonA]);
  await setOwnAdiSignature(db, a.id, SIG);
  assert.equal(await getOwnAdiSignature(db, a.id), SIG);
  assert.equal(await getOwnAdiSignature(db, b.id), null, "B's row is untouched");
});

test("access: team domain from ACCESS_TEAM_DOMAIN (default actgds); one cached JWKS per domain; issuer follows the domain", async () => {
  assert.equal(accessTeamDomain(undefined), "actgds.cloudflareaccess.com");
  assert.equal(accessTeamDomain(""), "actgds.cloudflareaccess.com");
  assert.equal(accessTeamDomain(" saas-team.cloudflareaccess.com "), "saas-team.cloudflareaccess.com");
  for (const bad of ["https://x.cloudflareaccess.com", "x.com/path", "a b", "x.com:8443", "evil.com#", "localhost"]) assert.throws(() => accessTeamDomain(bad), bad);
  assert.equal(accessIssuer("saas-team.cloudflareaccess.com"), "https://saas-team.cloudflareaccess.com");
  assert.equal(accessJwks("saas-team.cloudflareaccess.com"), accessJwks("saas-team.cloudflareaccess.com"));
  assert.notEqual(accessJwks("saas-team.cloudflareaccess.com"), accessJwks("actgds.cloudflareaccess.com"));

  // A token from another team (issuer) is rejected even if signed with the same key.
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" }] });
  const token = await new SignJWT({ email: "a@x.test" }).setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(accessIssuer("actgds.cloudflareaccess.com")).setAudience("aud").setExpirationTime("5m").sign(privateKey);
  const request = new Request("https://saas.example/", { headers: { "cf-access-jwt-assertion": token } });
  await assert.rejects(verifyAccessIdentity(request, jwks, "aud", accessIssuer("saas-team.cloudflareaccess.com")));
  assert.deepEqual(await verifyAccessIdentity(request, jwks, "aud", accessIssuer("actgds.cloudflareaccess.com")), { email: "a@x.test" });
});
