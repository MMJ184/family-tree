# Client demo build — brief for contributors

The client demo is the real web app (`apps/web`) running with no backend (spec decision #9).
Read `CLAUDE.md` and `docs/SPEC.md` first: they are the source of truth for roles, fields and rules.

## How the app is put together

- Monorepo: `packages/shared` (Zod schemas, `normalizeSearch`/`matchesSearch`, partial dates, kinship helpers),
  `packages/ui` (shadcn/Radix components: Button, Dialog, Sheet, Select, Tabs, DropdownMenu, AlertDialog, Command,
  Popover, Input, Textarea, Label, Switch, Checkbox, RadioGroup, ToggleGroup, Tooltip, Badge, Skeleton, ScrollArea…),
  `apps/web` (Vite 8, React 19, TanStack Router file routes + Query, Tailwind 4, i18next, Zustand, framer-motion).
- Mock backend: `apps/web/src/mock/db.ts` holds all tables in memory (saved to localStorage after `commit()`).
  `mock/guard.ts` has the access rules: `requireFamily(familyId, 'VIEW' | 'EDIT')`, `requireSuperAdmin()`,
  `requirePersonInFamily`, `familyPersonIds`, `redactPerson`, `redactBusiness`, `currentUser`.
  A family the user cannot access must be NOT_FOUND (never FORBIDDEN), so admins cannot learn other families exist.
- Service layer: `apps/web/src/api/*.ts`. Every function is `async`, wraps its body in `handle(() => …)` from
  `api/core.ts` (adds latency, deep-copies), throws `ApiError(code)` on failure, and is the only code that touches
  `mock/`. UI code never imports `mock/` directly. Validate inputs with the Zod schemas in `@family-tree/shared`.
  Write functions in the shape a REST API would have, because the real Hono API will replace these later.
- Query hooks live in `src/entities/<name>/`. After any write, invalidate `familyKeys.graph(familyId)` and
  `familyKeys.all` (from `entities/family/queries.ts`) plus your own keys.
- `useFamilyGraph(familyId)` returns `FamilyGraph` (family, people, memberships, parentChild, marriages,
  businesses, personBusiness), already redacted for the user's role. Most views should build from it.
- Role in the current family: `Route.useRouteContext().role` under `/_app/f/$familyId`, or
  `roleForFamily(useSession().data, familyId)`; `canEdit(role)` is true for SUPER_ADMIN and ADMIN.
  Viewers must not see edit controls.
- Layering (enforced by Biome): `lib/`, `components/`, `hooks/` must not import `entities/`, `features/`, `routes/`;
  `entities/` must not import `features/` or `routes/`; a feature must not import another feature.
  Routes import features.
- Shared helpers: `lib/display.ts` (`personName(p, locale)`, `personShortName`, `familyName`, `personYears`,
  `initials`), `components/shared/` (`PersonAvatar`, `PersonSearch`, `PageHeader`, `LoadingState`, `ErrorState`,
  `NotFound`, `YearSlider`), `lib/prefs.ts` (`usePrefs` → `locale`, `theme`; `isDark()`).
- Page wrapper for normal pages: `<div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">` with `PageHeader`.

## Rules every change must follow

- **No hard-coded UI strings.** Add keys to `src/locales/en/<namespace>.json` and `src/locales/ar/<namespace>.json`
  (same keys in both; real Arabic, not transliteration). Each file name is an i18next namespace; use
  `useTranslation('<namespace>')` and `common` for shared words (`actions.*`, `states.*`, `roles.*`, `gender.*`,
  `dates.*`, `errors.*`).
- **RTL:** Arabic is the default language. Use logical Tailwind classes only (`ms-/me-/ps-/pe-/start-/end-/
  text-start/border-s`), never `ml-/mr-/pl-/pr-/left-/right-/text-left`. Flip directional icons with
  `rtl:-scale-x-100`. Year ranges and phone numbers go in `<span className="ltr-isolate">`. Tree direction in
  Arabic is mirrored (spec decision #10): in horizontal layouts and timelines the earliest is on the right; in
  top-down trees siblings are ordered right to left. Both `dir` and `lang` are set on `<html>`; read
  `usePrefs().locale` or `i18n.language`.
- Names: show `personName(p, i18n.language)`. Search with `matchesSearch` from `@family-tree/shared`.
- Theme: colours come from CSS variables (`var(--ft-primary)`, `--ft-gold`, `--ft-male`, `--ft-female`,
  `--ft-card`, `--ft-foreground`, `--ft-muted-foreground`, `--ft-border`, `--ft-background`) or Tailwind tokens
  (`bg-card`, `text-primary`, `text-gold`, `bg-muted`…). Must look right in light and dark. Canvas/WebGL code that
  needs real colour values should read them with `getComputedStyle(document.documentElement)` and react to theme
  changes (`usePrefs((s) => s.theme)`).
- Design direction: premium and modern, glassmorphism (`.glass` class), soft shadows, smooth framer-motion
  transitions, `font-display` for headings. Responsive down to phone width.
- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Do **not** install packages. Available: react, @tanstack/react-router/-query/-form/-table, zod, i18next,
  react-i18next, framer-motion, lucide-react, sonner (`toast`), date-fns, zustand, three@0.186.1 (+ `three/examples/jsm/*`),
  @types/three, elkjs, @xyflow/react, force-graph, 3d-force-graph, mind-elixir@5.15.1. If you truly need another,
  say so in your report instead.
- Only edit files you own (listed in your task). If you need a change in a shared file, describe the exact change
  in your report instead of making it.

## Checking your work

- A Vite dev server is already running at http://127.0.0.1:3100 and regenerates `src/routeTree.gen.ts` when
  route files change. Do not start another one.
- Typecheck: `cd apps/web && npx tsc --noEmit`. Other people are editing other folders at the same time, so only
  fix errors in your own files; mention others in your report.
- Lint your files: `npx biome check <your paths>` from the repo root (fix with `--write`).
- Browser: use the claude-in-chrome tools in a **new tab you create** (do not touch other tabs), close it when done.
  Sign in at /login by clicking a demo user: Hamad Al Mansouri = Super Admin, Rashid = Admin of Al Mansouri,
  Omar = Admin of Al Mansouri + Al Kaabi, Hamad Al Kaabi = Admin of Al Kaabi, Dana = Viewer of Al Mansouri.
  Note: the session is shared across tabs (localStorage), so another agent may switch user under you; just sign in
  again. Family ids: `fam-mansouri` (~32 people), `fam-kaabi`, `fam-shamsi`, `fam-nuaimi` (≈500, Super Admin only).
  Check both Arabic (default) and English (button in the top bar), and light and dark theme.
- Report: what you built, file list, what you verified in the browser (with what you saw), what is not verified,
  and any requested changes to shared files.
