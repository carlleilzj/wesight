# Release Gate Checklist

Updated: 2026-06-03

This checklist captures the current P0 release gate for TASK-02-PR-2. It is limited to automated or developer-verifiable checks and does not cover macOS signing, notarization, or user-assisted installation validation.

## Required Checks

| Gate | Command | Passing Criteria | Current Notes |
|---|---|---|---|
| Build | `npm run build` | TypeScript, renderer, Electron main, and preload builds complete | Must remain green before release packaging |
| Lint | `npm run lint` | ESLint exits successfully with zero errors | Warnings are tracked as known issues for later cleanup |
| Unit tests | `npm test` | Vitest exits successfully | Includes cowork event log and external CLI environment regression coverage |
| Release notes | Review changelog or release notes draft | Fixed, changed, and known issues are represented | Changelog publication format remains a follow-up task |
| Known issues | Review `docs/known-issues.md` | Non-blocking warnings and release exclusions are explicit | Keep this updated whenever a gate passes with residual warnings |

## Out Of Scope For This Gate

- macOS code signing and notarization.
- Windows signing.
- Real new-user 3-minute success validation.
- Real long-session performance validation.
- Full cleanup of `@typescript-eslint/no-explicit-any` and React hook dependency warnings.

## Follow-Up Planning

Configuration backup and restore remain outside this PR. Future work should split that area into:

- Backup schema versioning and compatibility handling.
- Secret masking and secret reference export.
- Export section preview for settings, providers, engines, skills, and permission policy.
- Backup checksum and integrity validation.
- Restore preflight diff and missing-secret detection.
- Transactional restore with rollback checkpoint.
- Post-restore provider, engine, and skill validation.

