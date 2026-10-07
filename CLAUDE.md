# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Pre-code. The repo holds only `README.md` and the product spec `docs/SPEC.md` (v0.3, draft). There is no build, lint, or test tooling yet — add the real commands here once the frontend/backend are scaffolded. `docs/SPEC.md` is the source of truth; read it before designing or changing behavior, and update it (version + "Decisions" table in §10) when a decision changes.

## What is being built

Family Tree Manager: a multi-tenant web app where a **Client** account owns one or more **Families**, each with its own tree, members, relationships and businesses. Arabic is the client's primary language (full RTL); English is secondary. Hosted in a Middle East cloud region.

## Planned stack (spec §8)

- Frontend: React + TypeScript, Tailwind + shadcn/ui, Framer Motion. 2D views with D3 / React Flow; 3D/4D views with Three.js via `@react-three/fiber` + `@react-three/drei`.
- Backend: Node.js REST API. **Framework not yet chosen** (client will pick NestJS / Express / Fastify) — don't assume one.
- PostgreSQL (recursive CTEs for ancestor/descendant queries), S3-compatible storage in the same region, JWT auth + role guard, i18next for i18n, Docker deploy.

## Cross-cutting rules that shape the architecture

These span auth, data access and UI, so they must hold everywhere:

- **Tenant + family isolation.** Every query is scoped by `client_id` and family. Access is checked through `FamilyMember` (user → family, role ADMIN | VIEWER) and `FamilyPerson` (person → family). Isolation needs row-level checks *and* tests.
- **Family Admins must not learn other families exist.** No switcher or hint unless Super Admin assigned them to several families; then the switcher lists only those. Only Super Admin adds/removes Family Admins.
- **Roles:** Super Admin (whole client), Family Admin (edit one family), Viewer (read-only). In v1 only admins edit.
- **One Person, many families.** A married-in person on the same client is a single `Person` row linked to both families via `FamilyPerson` (membership BORN | MARRIED_IN); edits show in both trees and admins of either family can edit. Cross-client links are not allowed (use a free-text "married into" note instead).
- **Relationship invariants:** siblings are derived from shared parents, never stored; reject cycles on `ParentChild` insert (no one is their own ancestor); max 2 biological parents; multiple spouses allowed.
- **Businesses** are stored once and linked to many persons via `PersonBusiness`. Business contacts are visible to Viewers of the same family; registration/GST number is admin-only. Personal phone/email are hidden from Viewers by default.
- **Soft delete** for people, families (archive) and businesses (`deleted_at` / `archived_at`).
- **i18n/RTL from day one:** no hard-coded UI strings; use logical CSS properties / Tailwind `rtl:` variants; names stored in both Arabic and English; search must normalize Arabic alef/hamza/ta-marbuta variants. Dates may be year-only or approximate; Hijri display is optional.
- **Performance targets:** 2D tree smooth to 2,000 people per family; 3D ~60 fps at 500 people (level-of-detail / collapse, fallback to 2D on weak devices); 4D time slider replays births, marriages, deaths and businesses by year.

## Open questions (spec §10)

Backend framework, whether Hijri dates ship at launch, and the default tree direction in Arabic are undecided — ask rather than pick.
