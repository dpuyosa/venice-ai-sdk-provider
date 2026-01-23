# Agent Instructions (Venice AI SDK Provider)

These instructions apply to the entire repository.
Follow them for all agentic edits and reviews.

## Quick Facts

- Package: `venice-ai-sdk-provider` (TypeScript).
- Build tool: `tsup` (CJS + ESM + d.ts).
- Formatting: `prettier` (see `.prettierrc`).
- Type checking: `tsc` strict mode.
- Node version: `>=18` (package.json).

## Required Commands

Use `bun` unless the user asks otherwise.

### Install

- `bun install`

### Build

- `bun run build` (tsup build, outputs `dist/`).
- `bun run dev` (tsup watch).
- `bun run clean` (remove `dist/`).
- `bun run pack` (clean + build + npm pack).

### Lint / Format

- `bun run prettier-check` (prettier check).
- `bun run prettier-fix` (prettier write).
- `bun run type-check` (`tsc --noEmit`).

### Tests

When tests are added:

- `bun run test` (run all tests).
- `bun run test -- --watch` (watch mode).
- By file: `bun run test -- path/to/file.test.ts`.
- By test name: `bun run test -- -t "test name"`.

## Project Layout

- Source: `src/` (library entry is `src/index.ts`).
- Tests: `tests/` (co-located with source pattern).
- Build config: `tsup.config.ts`.
- TS config: `tsconfig.json`.
- Formatting config: `.prettierrc`.

## Code Style

Follow the existing patterns in nearby files first.
Prefer small, focused changes that preserve behavior.

### Formatting (Prettier)

- 4 spaces indentation (tabWidth: 4).
- Semicolons required.
- Single quotes for strings.
- Trailing commas where valid (es5).
- Bracket spacing enabled.
- Max line width 230.

### Imports

- Use ES module `import`/`export` syntax.
- Group imports: built-ins, external, then local.
- Keep import paths explicit and relative unless a package export exists.
- Avoid unused imports.
- Favor named exports for library surface.

### Types & Interfaces

- TypeScript is `strict`; do not loosen strictness.
- Avoid `any`; use `unknown` + narrowing.
- Prefer `type` aliases for unions and public API shapes.
- Use `interface` for extendable object contracts.
- Add explicit return types for exported functions.
- Let locals infer types unless clarity demands explicit types.
- Use `readonly` for immutable arrays/objects when appropriate.
- Use `as const` for literal config objects.

### Naming

- `camelCase` for variables/functions.
- `PascalCase` for types, interfaces, classes.
- `UPPER_SNAKE_CASE` for constants.
- File names: `kebab-case` for files, `camelCase` for implementation.
- Prefix internal helpers with `_` only when required.

### Error Handling

- Throw `Error` (or custom subclasses) with clear messages.
- Include `cause` when rethrowing (`new Error(msg, { cause })`).
- Catch only to add context or transform errors.
- Never swallow exceptions silently.
- Validate external inputs (prefer `zod` if available).

### Async / Promise

- Prefer `async`/`await` over raw `.then` chains.
- Avoid unhandled promises; always `await` or return.
- Keep async functions side-effect aware.

### API / Public Surface

- Keep public exports stable and minimal.
- Ensure new exports are reflected in `src/index.ts`.
- Avoid breaking changes unless requested.

### Tests

- Use `vitest` style (`describe`, `it`, `expect`).
- Co-locate tests in `tests/` to match `tsconfig` include.
- Prefer deterministic tests; avoid real network calls.
- Mock external calls with `@ai-sdk/test-server` where relevant.

### Build & Packaging

- `tsup` outputs CJS/ESM and `.d.ts`.
- Keep `__PACKAGE_VERSION__` define in sync (tsup config reads package.json).
- Do not write to `dist/` manually.

## Repository Hygiene

- Do not edit `dist/` or lockfiles unless requested.
- Keep `.gitignore` patterns intact.
- Avoid adding new top-level config files without approval.
- Do not add docs files unless asked.

## Notes on External Rules

- No `.cursorrules` or `.cursor/rules/` found.
- No `.github/copilot-instructions.md` found.
- If any are added later, follow them first.

## Suggested Review Checklist

- `bun run prettier-check` passes.
- `bun run type-check` passes.
- Relevant `bun run test` command passes (when tests exist).
- No unused exports/imports.
- Public API changes are intentional.

## Agent Behavior

- Be concise and safe; ask before large refactors.
- Keep edits minimal and aligned with existing style.
- Prefer editing existing files over creating new ones.
- Do not commit changes unless asked.
- Do not remove TODOs or comments without instruction.

## Contact / Ownership

- Repository owner: Venice AI SDK provider maintainers.
- If unclear, ask the user for guidance.

End of instructions.
