# Onyx Boox (Color E-Ink Tablet) Application for Handwritten Note-Taking

## Project Structure

Feature folders (`src/features/*`) must have 0 files as direct descendants.

All files must be placed in subfolders:

- `components/` — React components
- `atoms/` — Jotai atoms
- `machines/` — XState machines
- `views/` — screen-level components
- `utilities/` — default, if other folders are not more suitable
- `types/` — TypeScript types
- `plugins/` — third-party integrations/wrappers

One file, one purpose. We want to achieve total code co-location (not always possible).
In practice: Tests next to things they test, features grouped together - database to the UI.

## Validation After Changes

Use `pnpm lint` to check for linting errors. We use `biome` (lint & format) and
`ast-grep` rules that are not included in the `biome` package.

Use `pnpm test` to run `vitest` tests.

Not all changes can be tested by you - ask user for manual testing. Enable / add
debug logging (e.g. in Xstate machine) in case bugs arise and trace user actions through the app.

## Query Cache Invalidation

The `QueryClient` in `src/app/_layout.tsx` uses a global `onSuccess` handler on mutations that invalidates **all** queries after every mutation. This is intentional:

- Only visible (mounted) queries are refetched — React Query skips inactive ones.
- This eliminates manual, error-prone per-mutation `invalidateQueries` calls.
- Do NOT add targeted `invalidateQueries` in individual mutations — the global handler covers it.
- If a mutation should NOT trigger refetches, use `mutationClient.setMutationDefaults` to override.
