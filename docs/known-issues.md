# Known Issues

Updated: 2026-06-03

## P0 Release Gate Residuals

| Issue | Impact | Status | Follow-Up |
|---|---|---|---|
| ESLint warnings remain after lint errors are cleared | `npm run lint` passes, but warning debt is still visible in output | Accepted for TASK-02-PR-2 | Split warning cleanup by category: explicit `any`, unused vars, React hook deps |
| Renderer bundle remains large | Build passes, but renderer main JS is still large | Known performance risk | Address in P1 bundle splitting work |
| macOS signing and notarization are not covered by this gate | Release packaging may still need platform trust work | Explicitly out of scope | Handle in a separate signing/release trust task |
| Configuration backup and restore are not implemented | Users cannot yet export/import a safe config snapshot | Planned follow-up | Use the backup/restore subtasks in `docs/release-gate-checklist.md` as the starting breakdown |

## Warning Cleanup Buckets

- `@typescript-eslint/no-explicit-any`: type high-risk IPC and integration boundaries first.
- `@typescript-eslint/no-unused-vars`: remove dead variables or prefix intentionally unused values with `_`.
- `react-hooks/exhaustive-deps`: review component behavior before applying mechanical dependency changes.

