# Family Tree Manager — Product Spec v0.4

| | |
|---|---|
| Status | Draft |
| Owner | MMJ |
| Date | 2026-10-06 |
| Platform | Web app (desktop + mobile browser) |
| Frontend | React (high-end UI, 3D / 4D tree views) |
| Backend | Node.js (framework to be confirmed) |
| Languages | English + Arabic (Arabic is client's primary) — full RTL |
| Hosting | Cloud, Middle East region |

---

## 1. Problem & Goal

Families keep lineage in memory, paper charts, or WhatsApp messages. It gets lost, is hard to share, and nobody knows who is responsible for keeping it correct.

**Goal:** a web product where one client can manage one or more family trees (e.g. two different surnames), view them in several visual layouts, and control who can edit.

## 2. Users & Roles

The product is multi-tenant. A **Client** (customer account) owns one or more **Families**.

| Role | Scope | Can do |
|---|---|---|
| **Super Admin** | Whole client account | Create/archive families, assign Family Admins, see all families. Only role that knows multiple families exist under the account. |
| **Family Admin** | One family | Add / edit / delete members, relationships and businesses, upload photos, invite Viewers. **Cannot** add other admins. |
| **Viewer** *(v1)* | One family | Read-only view of that family's tree, member details and business contacts. |

Rules:
- A Family Admin sees **only** their own family — no family switcher, no hint of other families.
- **Only Super Admin** can add or remove Family Admins.
- A user can be admin of more than one family only if Super Admin assigns it; they then see a switcher limited to their families.
- For v1, **only admins edit**. Suggest-an-edit by viewers is a later phase.

## 3. Scope — v1 (MVP)

### 3.1 Family management (Super Admin)
- Create family: name, surname, native place, description, cover image.
- Assign / remove Family Admins (by email invite).
- Archive a family (soft delete).

### 3.2 Member (Person) details
| Field | Type | Required |
|---|---|---|
| First name, Middle name, Last name / surname | text | First name |
| Name in Arabic and English (both scripts) | text | no |
| Father's name, Grandfather's name (nasab), Tribe / Family name, Kunya, Laqab | text | no |
| Maiden name | text | no |
| Gender | Male / Female / Other | yes |
| Date of birth / Date of death | date with precision (full date, month-year, or year-only) and an "approx" flag; displayed in Gregorian (Hijri display: see open question 2) | no |
| Is living | bool | yes (default true; forced to false when a date of death is set) |
| Birth place / Current city | text | no |
| Photo | image | no |
| Phone, Email | text | no (personal contacts hidden from Viewers by default) |
| Occupation, Education | text | no |
| Notes / Biography | long text | no |
| Gotra / Community / Custom fields | key-value | no |

### 3.2.1 Business details (optional, per member)
A member can have **zero or more businesses**. Admin fills as much as known; only Business name and Type are required.

| Field | Type | Required |
|---|---|---|
| Business name | text | yes |
| Business type / Industry | select + "Other" (Manufacturing, Trading, Retail, Diamond, Textile, Agriculture, IT / Software, Real estate, Construction, Services, Professional practice, Import/Export, Other) | yes |
| Role in business | Owner / Co-founder / Partner / Director / Manager | no |
| Description / Products & services | long text | no |
| Started year / Ended year, Status (Active / Closed) | year, select | no |
| Address, City, State, Country, Map location | text / lat-lng | no |
| Phone, Email, Website | text | no |
| Social links (Instagram, Facebook, LinkedIn, WhatsApp Business) | url | no |
| GST / Registration no. | text | no (admin-only visibility) |
| Employees (range), Branches | select / list | no |
| Logo, Photos, Brochure / Catalogue | images / PDF | no |
| Family partners | link to other Persons in the tree | no |

Rules:
- Several family members can be linked to the **same business** (e.g. brothers as partners); business is stored once and linked.
- Business card shown on the person's detail panel; business badge/icon on the tree card.
- Searchable & filterable: "show all members in Diamond business", "businesses in Surat".
- Viewers in the **same family** can see business contact details (phone, email, address, website).
- GST / registration no. is **admin-only**.

### 3.3 Relationships
- Parent → Child (biological, adopted, step).
- Spouse (married, divorced, widowed) with marriage (start) date and optional end date. Multiple spouses supported.
- Siblings are **derived** from shared parents (not stored).
- **Married-in members — one record, both trees (decided):** a daughter who marries into another family *on the same client account* is stored as **one Person**. She appears in her parents' tree and her husband's tree; editing her in one place updates both. Admins of either family can edit her; Viewers of each family see her in their tree.
- If the other family is **not** on the same account, she keeps her maiden name and a free-text "married into" note.

### 3.4 Views
1. **Top-down tree** — classic ancestors at top, descendants below.
2. **Person-centred view** — pick a person; show parents, spouse(s), children, siblings.
3. **List / table view** — searchable, sortable, filter by generation, living/deceased, city.
4. **Generation view** — members grouped by generation number.

5. **3D tree view** — tree rendered in 3D space (WebGL): rotate, zoom, fly-to-person, generations as layers, member photos as cards/nodes, smooth animations. Falls back to 2D on low-end devices.
6. **4D (time) view** — the 3D tree plus a **time slider**: play the family growing over the years (births, marriages, deaths, businesses started appear in order). Pause at any year to see the family as it was then.

Design direction: premium, modern UI — glassmorphism/soft shadows, smooth transitions, dark & light theme, consistent design system.

Common controls: zoom, pan, collapse/expand branch, click a card to open details, "focus on me".

### 3.4.1 Language & RTL (v1)
- UI fully available in **English and Arabic**; Arabic is the default for this client.
- Full **right-to-left** layout when Arabic is active: mirrored navigation, forms, tree direction options, numbers and dates localized.
- Names and text fields store both scripts; search works in Arabic and English (normalize alef/hamza/ta-marbuta variants).
- Arabic-friendly typography (e.g. IBM Plex Sans Arabic / Cairo / Tajawal).
- Built with i18n from day one (e.g. `i18next`) so more languages can be added later.

### 3.5 Search
- By name (any part), city, birth year.
- Jump-to-person in the tree.

### 3.6 Export
- Tree as PNG / PDF.
- Member list as CSV / Excel.

## 4. Suggested Features — Later Phases

### v1.1 — Sharing & collaboration
- **Suggest an edit**: viewers propose changes, admin approves.
- Audit log: who changed what, when; undo.
- Privacy: per-family settings to hide living people's DOB (and other fields) from viewers. (Personal contacts are already hidden from viewers by default in v1 — see 3.2.)

### v1.2 — More visualizations
- **Fan / radial chart** of ancestors.
- **Descendant chart** (horizontal, good for wide families).
- **Timeline** of births, marriages, deaths.
- **Map view** — birth places / current cities on a map.
- **Relationship finder** — "How is A related to B?" → e.g. *Father's brother's son (cousin)*, with Arabic kinship terms (عم، خال، عمة، خالة، ابن عم…) and English.
- Print-friendly poster layout.

### v1.3 — Engagement
- Birthday & anniversary reminders (email / WhatsApp).
- Photo gallery & documents per person (certificates, old letters).
- Stories / memories timeline per person.
- Family events page (weddings, gatherings).

### v2 — Product / scale
- Link two families via marriage (cross-family navigation, with permission).
- GEDCOM import/export (standard genealogy format).
- Additional languages beyond English / Arabic.
- Duplicate-person detection & merge.
- Statistics dashboard (members per generation, average lifespan, cities).
- Mobile app / PWA offline mode.
- Subscription plans per client (families count, storage).

## 5. Data Model (draft)

```
Client        (id, name, plan, created_at)
User          (id, client_id, name, email, password_hash, is_super_admin, locale: ar | en)
Family        (id, client_id, name, surname, native_place, description, cover_url, archived_at)
FamilyMember  (user_id, family_id, role: ADMIN | VIEWER)          -- access control
Person        (id, client_id, first_name, middle_name, last_name, maiden_name,
               gender, dob, dob_precision, dob_approx, dod, dod_precision, dod_approx,
               is_living, birth_place, current_city,
               name_ar, name_en, father_name, grandfather_name, tribe_name, kunya, laqab,
               photo_url, phone, email, occupation, education, notes,
               custom_fields JSON, created_by, updated_by, timestamps, deleted_at)
FamilyPerson  (family_id, person_id, membership: BORN | MARRIED_IN)  -- person can be in 2 families
ParentChild   (id, parent_id, child_id, type: BIOLOGICAL | ADOPTED | STEP)
Marriage      (id, person_a_id, person_b_id, status: MARRIED | DIVORCED | WIDOWED,
               start_date, end_date)
Business     (id, family_id, name, type, type_other, description, started_year, ended_year,
               status, address, city, state, country, lat, lng, phone, email, website,
               social_links JSON, registration_no, employees_range, branches JSON,
               logo_url, media JSON, timestamps, deleted_at)
PersonBusiness (person_id, business_id, role)                     -- many-to-many
AuditLog          (id, family_id, user_id, entity, entity_id, action, diff JSON, at)
```

Constraints:
- Every query is scoped by client and family; access checked via `FamilyMember` + `FamilyPerson`.
- A Person may link to multiple families only within the **same client**.
- A person cannot be their own ancestor (cycle check on ParentChild insert).
- Max 2 biological parents per person.
- `*_precision` is DAY | MONTH | YEAR; for MONTH/YEAR the unused parts of the date are stored as 1 and ignored on display.
- If `dod` is set, `is_living` must be false.

## 6. Key User Flows

1. **Super Admin onboarding** → sign up → create "Mangukiya Family" → invite admin by email.
2. **Admin builds tree** → add root person → "Add child / spouse / parent" from the person card → tree updates live.
3. **Second family** → Super Admin creates "Patel Family" → assigns a different admin → each admin sees only their own family.
4. **Married-in** → admin of Family B adds a spouse → selects an existing person from Family A (same account) → she now appears in both trees.
5. **Viewing** → open tree → switch view (tree / person / list / generation / 3D / 4D) → search → export PDF.

## 7. Non-Functional Requirements
- Responsive; usable on phone browsers.
- Tree renders smoothly up to **2,000 people** per family (2D); 3D view uses level-of-detail / collapse for large trees.
- Data isolation between clients and between families (row-level checks + tests).
- Daily backups; soft delete for people and families.
- HTTPS, hashed passwords, optional Google login.
- Hosted in a **Middle East cloud region** (e.g. AWS me-central-1 UAE / Azure UAE North) for latency and data residency; deployed with Docker.

## 8. Tech Stack
- **Frontend (decided):** React + TypeScript, Tailwind + component library (e.g. shadcn/ui), Framer Motion for animation.
  - 2D views: D3 / React Flow.
  - 3D / 4D views: Three.js via `@react-three/fiber` + `@react-three/drei`; time slider drives the 4D playback.
- **Backend (decided: Node.js):** framework to be provided by client (NestJS / Express / Fastify) — REST API.
- **DB:** PostgreSQL (recursive CTEs for ancestors/descendants).
- **Storage:** S3-compatible for photos (same region).
- **i18n:** i18next + Tailwind RTL utilities (`rtl:` / logical properties).
- **Auth:** JWT sessions + role guard.

## 9. Out of Scope for v1
DNA integration, public search across families, payments, native mobile apps, GEDCOM.

## 10. Decisions & Open Questions

**Decided (2026-10-06)**
| # | Question | Decision |
|---|---|---|
| 1 | Married-in daughter on same account | One Person record, shown in both trees |
| 2 | Who adds Family Admins | Super Admin only |
| 3 | Launch languages | English + Arabic (Arabic primary, full RTL) |
| 4 | Hosting | Cloud, Middle East region |
| 5 | Viewer role in v1 | Yes |
| 6 | Business contact visibility | Visible to Viewers of same family; GST/registration admin-only |

**Still open**
1. Backend Node framework — to be provided by client.
2. Hijri date display — needed at launch or later?
3. Default tree direction in Arabic (right-to-left horizontal vs. top-down)?

## 11. Success Criteria (v1)
- Super Admin can create 2 families and they are fully isolated.
- Admin can add 100 members with relationships in under 30 minutes.
- All four 2D views (top-down, person-centred, list, generation) render correctly for a 4-generation test family; 3D/4D criteria below.
- Export PDF of tree works on desktop.
- 3D view stays smooth (~60 fps on a normal laptop) for 500 members; 4D playback runs across 100 years.
- Admin can add a business with partial details and link 2+ family members to it.
- Whole app usable in Arabic with correct RTL layout; switching to English works without reload issues.
- A married-in daughter edited in one family shows the change in the other family's tree.
