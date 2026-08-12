@AGENTS.md

# DomainKit

## Stack
- Next.js 16 App Router, TypeScript, Tailwind CSS v4
- Catalyst UI kit (HeadlessUI) — vendored in src/components/ui/
- Supabase Postgres (service-role only, RLS with no policies)
- Claude Haiku 4.5 for AI diagnosis + help chat
- Google DNS-over-HTTPS for all lookups

## Before pushing
1. `npm run build` must exit 0
2. `npm test` must pass
3. Re-read your diff for mistakes or debug logs

## CI
- Local CI via `npm run ci` (lint → test → build → typecheck)
- Do NOT add GitHub Actions workflow files
