# Phase 4B geographic database contract

Baseline `c2d645b2a20f6991b8950288530238f3696da8f0`, branch
`feat/supervisor-web-redesign`. The forward-only migration is
`20261125110447_sprint_4b_site_geography.sql`.

## Records and RPCs

- `sites` retains its ID, code, name and active state. The migration adds
  an optimistic-lock revision starting at 1. New site codes are normalized
  to uppercase. Site edits preserve the code.
- `site_geography` contains at most one row per site. Details, center and
  perimeter are independently nullable. The perimeter can exist on its own.
- `security_posts` uses a stable ID and an immutable site ID, with a
  site-unique uppercase code, name, active state, optional point and revision.
  The unique key `(site_id, id)` is the future shift reference. The existing
  shift and handover text post fields are unaffected.

| RPC | Parameters and result |
| --- | --- |
| `list_managed_sites` | Optional `p_site_id`. Returns matching site objects with status, revisions, details, GeoJSON, and edit permission flags. |
| `list_site_security_posts` | `p_site_id`. Returns that site's posts with GeoJSON and nullable `outside_boundary`. |
| `create_managed_site` | `p_code`, `p_name`. Returns the new site with the creator assigned as its admin in the same transaction. |
| `update_managed_site` | `p_site_id`, `p_expected_revision`, `p_name`, `p_is_active`. Returns the updated site. |
| `save_site_geography` | `p_site_id`, `p_expected_revision`, `p_details`, `p_center`, `p_boundary`. Revision zero creates the row. Nullable fields are explicit replacements. Returns the updated site. |
| `create_security_post` | `p_site_id`, `p_code`, `p_name`, `p_location`. Returns the post. |
| `update_security_post` | `p_site_id`, `p_post_id`, `p_expected_revision`, `p_code`, `p_name`, `p_is_active`, `p_location`. Returns the updated post. |

The list RPCs return no records for an inaccessible scope. Mutations reject
unauthorized scopes with `42501`, stale revisions with `PT409`, and invalid
GeoJSON with `22023`. Uniqueness conflicts return `23505`. A successful
mutation and its audit event commit together.

The geography RPCs take 2D GeoJSON geometry objects with longitude first,
latitude second. They accept SQL null for an absent geometry. Point and
single-ring Polygon are supported, with a maximum of 256 non-closing
vertices and 32 KiB per normalized JSONB geometry. Raw numeric coordinates,
structure, ranges, ring closure, area and intersections are checked before
conversion. PostGIS then verifies the typed WGS84 geometry. Holes,
MultiPolygons, foreign CRS metadata and cross-antimeridian edges are
unsupported. A post on the perimeter is considered covered by the polygon.
The warning is null when a post location or perimeter is unavailable.

## Authorization and lifecycle

| Caller | Assigned active site | Assigned inactive site | New site |
| --- | --- | --- | --- |
| Active admin | Read, edit and deactivate | Read and reactivate | Create and receive own assignment atomically |
| Active supervisor | Read and edit site name, geography and posts | Read only | Denied |
| Guard, anonymous, inactive account, or unassigned actor | No management access | No management access | Active administrators only |

An active administrator with no site assignment can create a site. Reading
or modifying an existing site still requires its current matching-role
assignment. Scope and audit actor derive from the database-verified session
identity. Public RPCs run as invokers and delegate to narrowly granted
executors in `private`. The geographic mutation and interlock executor roles
cannot log in or bypass RLS. The Auth identity helper returns only the
current user ID. Geographic tables have RLS and no app-role direct grants.

Existing operational policies still exclude inactive sites. Post edits and
operational writes that open a shift or incident acquire a shared site row
lock. Site deactivation takes a conflicting lock and checks for scheduled or
active shifts and unresolved incidents. Deactivation uses READ COMMITTED so
the blocker check can see the committed winner after the wait. Trusted shift
scheduling is also subject to the interlock.

The server cannot see records queued only on a phone. An incident,
occurrence entry, or handover queued before deactivation can still fail to
sync afterward, since operational writes require an active site. Confirm
outboxes with affected guards before deactivation. Any later reconciliation
requires an authorized workflow. The migration does not change sync receipt
semantics or backfill geographic data.

## Local verification

Replay all migrations in order against a fresh container from the same
Supabase PostgreSQL image, with networking disabled and no shared volumes.
The PostgreSQL image provides base Auth roles and tables. Bootstrap Storage
using a schema-only local Storage dump, excluding the three
`incident_photo_*` policies installed by migration 202611190003. The image
already provides the empty Storage schema. Use a single transaction for
migrations that do not include their own transaction. Run the SQL suite as
`supabase_admin`; its temporary fixtures roll back.

```powershell
Get-Content -Raw supabase/tests/phase_4b_geography.sql |
  docker exec -i baseguard-phase4b-review psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1
node supabase/tests/phase_4b_concurrency.mjs
```

The concurrency suite commits isolated fixtures so multiple connections can
see them. Its target is the disposable container named above. Remove that
container after reviewing results.

On the existing Baseguard stack, use the installed CLI's local
`migration up` only after disposable replay and a pre-migration snapshot.
CLI 3.4.0 identifies the local target by displaying `127.0.0.1:54322`.
Run local database advisors before and after. This phase does not require a
reset of that stack or a hosted project connection.

### Checkpoint results

- Eight migrations replayed on disposable PostgreSQL 17.12. The SQL suite
  passed 74 assertions and the multi-session suite passed eight checks.
- The existing stack moved from seven to eight migrations. All 14 public
  tables have RLS. PostGIS 3.3.7 is installed in `geo_extensions`.
- Counts and row fingerprints matched for all 16 checked legacy tables
  across public, Auth and Storage. The site fingerprint intentionally
  excludes the newly added revision. The two new tables started empty.
- All 82 checked new catalog entries match the disposable replay. Existing
  function and RLS-policy fingerprints stayed unchanged on the Baseguard
  stack. The replay still differs in formatting for
  `private.can_view_guard_identity`, `public.close_incident`, and
  `public.list_site_personnel`. Their whitespace-normalized bodies and
  checked function metadata match.

Previously known advisor warnings, unchanged after migration:

1. `incident_photos_read` on `incident_photos` re-evaluates the Auth
   expression per row.
2. `profiles` has multiple permissive SELECT policies for `authenticated`.
3. `site_assignments` has multiple permissive SELECT policies for
   `authenticated`.

New advisor findings at WARN and above: none in security or performance.
