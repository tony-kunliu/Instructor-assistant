# ECOSYSTEM_ROADMAP.md

Shared long-term direction across the two-repo ecosystem: `tony-kunliu/
instructor-assistant` (this repo — Teaching/Lesson source of truth) and
`tony-kunliu/actgds.com` (ACTGDS Website — Customer/Student Identity source
of truth). See `AGENTS.md` §10 for the permanent boundary rules between
them.

This file is a **direction**, not an authorization. Reaching one phase does
not grant permission to start the next — every task still needs Tony's
explicit go-ahead, and every task still ends with a stop (see `AGENTS.md`
§11).

## P0 — Integration V1

Instructor Assistant sends a lesson summary (`lesson.upserted`) to ACTGDS
whenever a lesson is created or edited. See `docs/integrations/
actgds-instructor-assistant-v1.md` for the contract.

**Current gate status:**

- **Status:** NON-PRODUCTION COORDINATED QA PASS (no outstanding
  blockers); NOT LIVE IN PRODUCTION
- **Canonical contract hash:**
  `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`
- **Next:** Production rollout — requires Tony's separate, explicit
  authorization; nothing further is pending in non-Production.

See `STATUS.md` for the full current-state detail (deployed versions,
migration levels, webhook/secret/enablement status).

## P1 — Student Account

**Status:** NOT STARTED.

Students can view their own lesson history, hours, km, and CBT&A progress
on the ACTGDS website, fed by the P0 integration data ACTGDS has received
and stored on its own side.

## P2 — Lesson Notification

An automatic email to the student/parent after a lesson is saved, sent by
ACTGDS (which owns notifications and contact details), triggered by the P0
event stream.

## P3 — Booking → Instructor Assistant

Cal.com / ACTGDS Booking data flows into Instructor Assistant so an
instructor's "Today's Lessons" can be pre-populated from what was booked,
rather than started from scratch each time.

## P4 — GPS Tracking V1

GPS route, distance, moving time, and stopped time captured per lesson.

## P5 — Drive Intelligence

Higher-level driving analysis: roundabouts, traffic-light intersections, T
intersections, crossroads, Stop/Give Way signs, pedestrian crossings,
speed-limit zones, motorway entry/exit — derived from P4's GPS data.

## P6 — Driving Journey

The learner's full long-term driving history across licence stages —
Learner → P1 → P2 → Full Licence — spanning both systems.
