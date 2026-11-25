# Sprint 3.5 - Backend Foundation

## Local environment
- Supabase CLI: 3.4.0
- Docker Desktop with WSL2
- API: http://127.0.0.1:54321
- Studio: http://127.0.0.1:54323
- Mailpit: http://127.0.0.1:54324
- Supervisor web: http://127.0.0.1:5180

## Validation
- 52 previously reported automated tests passed.
- 34 manual integration checks completed.
- All 12 public tables have RLS enabled.
- All seven migrations replay successfully.
- No security warnings reported by local advisors.
- Three performance warnings remain.
- Three function bodies match after whitespace normalization.
- Hosted database remains unchanged.

## Local test accounts
- supervisor@baseguard.test
- guard1@baseguard.test
- guard2@baseguard.test
- guard3@baseguard.test (invited)

Create the initial three accounts through local Supabase Auth.
Use locally chosen test passwords. Never commit credentials.

## Test sites
- TEST-AVO: Avondale Test Site
- TEST-BOR: Borrowdale Test Site

Assign the supervisor and Guard One to Avondale.
Assign Guard Two to Borrowdale.
Invite Guard Three through the supervisor application.

## Known limitations
- Incident closure frontend action requires integration.
- Historical personnel access requires privacy review.
- RLS performance optimizations remain outstanding.
- Schema diff engines report whitespace-only function body
  differences; complete metadata equivalence is not yet proven.
- Automated test-data provisioning remains outstanding.
- Physical mobile integration remains outstanding.
- Hosted schema reconciliation is required before deployment.

## Safety
Do not push migrations to the hosted database without
an approved rollout, reconciliation and backup.
