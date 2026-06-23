# Agent Instructions (Venice AI SDK Provider)

Apply to every edit in this repository.

## Quick Facts

- Package: `venice-ai-sdk-provider` (TypeScript). Current version in `package.json`.
- Purpose: Vercel AI SDK v6 provider for the Venice AI OpenAI-compatible API (`https://api.venice.ai/api/v1`).
- Target SDK contract: `LanguageModelV3` / `ProviderV3` / `EmbeddingModelV3` / `ImageModelV3` from `@ai-sdk/provider@^3`. `ai` peer dep is `^6`.
- Default branch: `v6`. `main` is older (`v5` lineage).
- Node: `>=18` (see `engines`).

## Commands

Use `bun` unless the user says otherwise. `package-lock.json` exists alongside `bun.lock`; do not regenerate the lockfile unless asked.

- `bun install`
- `bun run build` - `tsup --tsconfig tsconfig.build.json` (CJS + ESM + `.d.ts`, sourcemaps, `dist/`).
- `bun run dev` - `tsup --watch`.
- `bun run type-check` - `tsc --noEmit` against `tsconfig.json`. **Only checks `src/`** (`include: ["src"]`). Tests are not type-checked here.
- `bun run prettier-check` / `bun run prettier-fix` - prettier on `**/*.ts*` (`.prettierignore` excludes `node_modules`, `dist`, `logs`).
- `bun run test` - `vitest`. `tests/` is currently empty; the `vitest` binary is not in `devDependencies` (it resolves transitively via Bun). Add `vitest` to `devDependencies` before adding tests.
- `bun run clean` - `rm -rf dist` (Unix syntax; Bun handles it on Windows).
- `bun run pack` - clean + minified tsup build + `npm pack --pack-destination=pack`.

Pre-commit hook (`.husky/pre-commit`) runs `npx lint-staged`, which runs `prettier --write` on staged `*.{ts,tsx}`.

## Project Layout

- Source: `src/`. Library entry: `src/index.ts` (re-exports `createVenice`, `venice`, `VeniceProvider`, `VeniceProviderSettings`, `VeniceLanguageModelOptions`, `VERSION`). New public exports must be added here.
- Key modules:
  - `venice-provider.ts` - `createVenice()`, env/header setup, default `venice` instance. Reads `VENICE_API_KEY`.
  - `venice-chat-language-model.ts` - chat completions (`doGenerate`, `doStream`). Owns Venice-specific streaming quirks (`<think>` mocking for `qwen3-4b`, reasoning-end-before-text, `extra_content.google.thought_signature` passthrough).
  - `venice-prepare-tools.ts` - tool/toolChoice mapping for the OpenAI-compatible wire format.
  - `convert-to-venice-chat-messages.ts` - prompt → Venice chat messages (handles Claude content-array forcing, multimodal conversion for image/audio/video files).
  - `venice-chat-options.ts` - Zod schemas for `veniceParameters` and `veniceLanguageModelOptions`.
  - `venice-prepare-parameters.ts` - camelCase → snake_case for `venice_parameters`.
  - `venice-response.ts` - response and SSE chunk Zod schemas (`z.looseObject`).
  - `venice-chat-usage.ts` - raw usage → `LanguageModelV3Usage` (nested `inputTokens`/`outputTokens`/`raw`).
  - `venice-error.ts`, `map-finish-reason.ts`, `get-response-metadata.ts`, `version.ts`.
- Tests: `tests/` (empty).
- Build outputs (do not edit): `dist/`, `pack/`.
- Other: `.husky/`, `.npmrc`, `logs/` (debug artifacts - gitignored).

## Conventions That Differ From Defaults

- Zod v4 via subpath imports: `import { z } from 'zod/v4'` (NOT `zod`). Use v4 APIs: `z.int()`, `z.looseObject()`, `z.union()`, etc. `zod` is in `devDependencies` at `^4`.
- `tsconfig.json` is strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames`). Do not relax these. `verbatimModuleSyntax` means type-only imports must use `import type`.
- Prettier: 4-space indent, single quotes, trailing commas (`es5`), bracket spacing, `printWidth: 230`.
- All exported functions must have explicit return types (project-wide rule). Locals may infer.
- New public surface must be added to `src/index.ts`. Internal modules use kebab-case file names; functions/vars are `camelCase`; types/classes `PascalCase`; constants `UPPER_SNAKE_CASE`.
- Prefer `type` aliases for union/structural shapes; `interface` for extendable object contracts. Avoid `any` - use `unknown` and narrow. Use `readonly` and `as const` where appropriate.
- Errors: throw `Error` with clear messages; include `cause` when rethrowing. Catch only to add context. Validate external input with Zod (v4).
- Async: `async`/`await`; no unhandled promises.

## Vercel AI SDK v6 Wiring (gotchas)

- `VeniceChatLanguageModel` declares `specificationVersion = 'v3'`. The provider object also sets `provider.specificationVersion = 'v3'` (see `venice-provider.ts:103`). Keep these in sync.
- `doStream` must emit a `{ type: 'stream-start', warnings }` event as the first chunk (see `venice-chat-language-model.ts:345`). V3 requires it.
- `finishReason` is `{ unified, raw }` (not a string). Errors emit `{ unified: 'error', raw: undefined }`.
- `usage` uses the nested V3 shape: `inputTokens.{total,noCache,cacheRead,cacheWrite}` and `outputTokens.{total,text,reasoning}`, plus `raw`. The flat `LanguageModelV2Usage` is gone.
- Tool warnings use `SharedV3Warning` with `{ type: 'unsupported', feature }`; the V2 `{ type: 'unsupported-tool', tool }` is invalid. In `prepareTools`, check `tool.type === 'provider'` (NOT `'provider-defined'`).
- Provider options keys: prefer `venice`. The deprecated `openai-compatible` key is still parsed and emits a `'other'` warning; `openaiCompatible` is the transitional alias. Merge order in `getArgs`: deprecated < `openaiCompatible` < `venice`.
- Before any text or tool-call stream chunk, close the active reasoning block (`reasoning-end`).
- `qwen3-4b` has special handling: it doesn't emit native `reasoning_content`, so `<think>…</think>` tags in text are parsed and re-emitted as reasoning segments (`isThinkingModel`).

## Build / Packaging Notes

- `tsup` externalizes `@ai-sdk/provider`, `@ai-sdk/provider-utils`, `@ai-sdk/openai-compatible` (declared in `tsup.config.ts`). Keep them external so consumers resolve them.
- `tsup` injects `__PACKAGE_VERSION__` from `package.json` at build time. `src/version.ts` falls back to `'0.0.0-test'` when the define is absent (e.g. raw `tsc`).
- `bun run pack` produces a minified `.tgz` in `pack/`. Do not hand-edit anything in `dist/` or `pack/`.
- Bump version in `package.json` when shipping; remember `bun.lock` may need regenerating if deps change (only if asked).

## Review Checklist (before declaring done)

- `bun run prettier-check` passes.
- `bun run type-check` passes (this only covers `src/`).
- If tests exist: `bun run test` passes.
- No unused imports/exports; new public exports added to `src/index.ts`.
- Public API surface unchanged unless the user asked for a breaking change.
- No edits to `dist/`, `pack/`, `logs/`, `bun.lock`, `package-lock.json` unless explicitly requested.

## Agent Behavior

- Be concise; ask before large refactors.
- Prefer editing existing files; do not add top-level config or docs files without approval.
- Do not commit, push, or open PRs unless explicitly asked.
- Do not strip TODOs or existing comments without instruction.
- Follow patterns already in `src/` rather than inventing new ones.

