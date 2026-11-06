# Agent Instructions (Venice AI SDK Provider)

Apply to every edit in this repository.

## Quick Facts

- Package: `venice-ai-sdk-provider` (TypeScript). Current version in `package.json`.
- Purpose: Vercel AI SDK v7 provider for the Venice AI OpenAI-compatible API (`https://api.venice.ai/api/v1`).
- Target SDK contract: `LanguageModelV4` / `ProviderV4` / `EmbeddingModelV4` / `ImageModelV4` from `@ai-sdk/provider@4.0.36`. `ai` peer dep is `^7`. Related pins: `@ai-sdk/provider-utils@5.0.75`, `@ai-sdk/openai-compatible@3.0.86`.
- Default branch: `v6` (AI SDK 6 line). Do not create or switch branches unless asked.
- Node: `>=24` (see `engines`). AI SDK 7 requires `>=22`; this package keeps the stricter floor.
- Output is **ESM-only**. Do not re-introduce CommonJS.

## Commands

Use `bun` unless the user says otherwise. `bun.lock` is the only lockfile; regenerate it only when dependencies change as part of an approved task.

- `bun install`
- `bun run build` - `tsup --tsconfig tsconfig.build.json` (ESM + `.d.ts`, sourcemaps, `dist/`).
- `bun run dev` - `tsup --watch`.
- `bun run clean` - `rm -rf dist` (Unix syntax; Bun handles it on Windows).
- `bun run typecheck` - `tsc --noEmit` against `tsconfig.json`. **Only checks `src/`** (`include: ["src"]`). Tests are not type-checked here.
- `bun run lint` / `bun run lint:fix` - Biome check (and `--write`) on `src/**` per `biome.json`.
- `bun run format` - `biome format --write` on `src/**`.
- `bun run test` - `vitest run`. `vitest` is in `devDependencies`. Tests live in `tests/*.test.ts`.
- `bun run pack` - clean + minified tsup build + `bun pm pack --destination pack`.

Pre-commit hook (`.husky/pre-commit`) runs `bunx lint-staged`, which runs `biome check --write --no-errors-on-unmatched` on staged `*.{ts,tsx,json}`.

## Project Layout

- Source: `src/`. Library entry: `src/index.ts` (re-exports `createVenice`, `venice`, `VeniceProvider`, `VeniceProviderSettings`, `VeniceLanguageModelOptions`, `VERSION`). New public exports must be added here.
- Key modules:
  - `venice-provider.ts` - `createVenice()`, env/header setup, default `venice` instance. Reads `VENICE_API_KEY`.
  - `venice-chat-language-model.ts` - chat completions (`doGenerate`, `doStream`). Owns Venice-specific streaming quirks (reasoning-end-before-text, `reasoning_details` / `reasoning_encrypted` handling).
  - `venice-prepare-tools.ts` - tool/toolChoice mapping for the OpenAI-compatible wire format.
  - `convert-to-venice-chat-messages.ts` - prompt → Venice chat messages (handles Claude content-array forcing, multimodal conversion for image/audio/video files, tagged V4 file data).
  - `venice-chat-message.ts` - Venice wire message/content-part types.
  - `venice-chat-options.ts` - Zod schemas for `veniceParameters` and `veniceLanguageModelOptions`.
  - `venice-prepare-parameters.ts` - camelCase → snake_case for `venice_parameters`.
  - `venice-response.ts` - response and SSE chunk Zod schemas (`z.looseObject`).
  - `venice-chat-usage.ts` - raw usage → `LanguageModelV4Usage` (nested `inputTokens`/`outputTokens`/`raw`).
  - `venice-metadata-extractor.ts` - streaming metadata extraction.
  - `venice-error.ts`, `map-finish-reason.ts`, `get-response-metadata.ts`, `version.ts`.
- Tests: `tests/` (unit tests plus `ai@7` integration tests).
- Build outputs (do not edit): `dist/`, `pack/`.
- Other: `.husky/`, `.npmrc` (publish auth, gitignored), `biome.json`, `logs/` (debug artifacts - gitignored).

## Conventions That Differ From Defaults

- Zod v4 via subpath imports: `import { z } from 'zod/v4'` (NOT `zod`). Use v4 APIs: `z.int()`, `z.looseObject()`, `z.union()`, etc. `zod` is a peer dependency and a devDependency; it is externalized in the build.
- `tsconfig.json` is strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames`). Do not relax these. `verbatimModuleSyntax` means type-only imports must use `import type`.
- Biome (`biome.json`): 4-space indent, single quotes, trailing commas (`es5`), semicolons always, `lineWidth: 230`, LF line endings. Scope is `src/**`.
- All exported functions must have explicit return types (project-wide rule). Locals may infer.
- New public surface must be added to `src/index.ts`. Internal modules use kebab-case file names; functions/vars are `camelCase`; types/classes `PascalCase`; constants `UPPER_SNAKE_CASE`.
- Prefer `type` aliases for union/structural shapes; `interface` for extendable object contracts. Avoid `any` - use `unknown` and narrow. Use `readonly` and `as const` where appropriate.
- Errors: throw `Error` with clear messages; include `cause` when rethrowing. Catch only to add context. Validate external input with Zod (v4).
- Async: `async`/`await`; no unhandled promises.
- **Claude cache compatibility:** Claude models always use content-block arrays, including tool messages, and tool-only assistant turns use `"\n"` instead of `null`. This is intentional: Anthropic prompt caching is byte-exact, `cache_control` must live on content blocks, and empty text blocks cannot be cached. Do not normalize these back to strings/null or "align" them with `@ai-sdk/openai-compatible` or Venice's OpenAPI, which types tool content as a string.

## Vercel AI SDK v7 / Spec V4 Wiring (gotchas)

- `VeniceChatLanguageModel` declares `specificationVersion = 'v4'`. The provider object also sets `provider.specificationVersion = 'v4'`. Keep these in sync.
- Use the V4 type family everywhere: `LanguageModelV4*`, `EmbeddingModelV4`, `ImageModelV4`, `ProviderV4`, `SharedV4ProviderMetadata`, `SharedV4Warning`. V3 types still exist in `@ai-sdk/provider@4` for backwards compatibility - do not reintroduce them here.
- `doStream` must emit `{ type: 'stream-start', warnings }` as the first chunk.
- `finishReason` is `{ unified, raw }`. A stream that ends without a finish reason emits `{ unified: 'interrupted' }`; an `error` part is emitted only when no content was produced.
- `usage` uses the nested V4 shape: `inputTokens.{total,noCache,cacheRead,cacheWrite}` and `outputTokens.{total,text,reasoning}`, plus `raw`. It is structurally identical to V3, but the type is `LanguageModelV4Usage`.
- Tool warnings use `SharedV4Warning`. Use the `{ type: 'deprecated', setting, message }` variant for the legacy `openai-compatible` provider-options key. In `prepareTools`, check `tool.type === 'provider'` (NOT `'provider-defined'`).
- Provider options keys: prefer `venice`. The deprecated `openai-compatible` key is still parsed and emits a `deprecated` warning; `openaiCompatible` is the transitional alias. Merge order in `getArgs`: deprecated < `openaiCompatible` < `venice`.
- Top-level `reasoning` maps to `reasoning_effort`; provider options (`reasoningEffort`) take precedence. `'provider-default'` is omitted, and an explicit `null` from provider options is preserved.
- Before any text or tool-call stream chunk, close the active reasoning block (`reasoning-end`).
- Venice Gemini-family responses use `reasoning_details` / `reasoning_encrypted` for reasoning metadata; do not assume Google `extra_content.thought_signature` is present.
- V4 file data is a tagged union (`SharedV4FileData`): `{ type: 'data' | 'url' | 'reference' | 'text' }`. Unwrap it before building Venice content parts. `reference` has no Venice equivalent and must throw.
- `mediaType` may be a bare top-level segment (`'image'`, `'audio'`, `'video'`, `'text'`). Dispatch with `getTopLevelMediaType()` and resolve subtypes with `detectMediaType()` / `isFullMediaType()` from `@ai-sdk/provider-utils`.
- Tool-result `content` output uses a single `file` part with tagged data. The legacy `image-*` / `file-*` variants are gone.

## Build / Packaging Notes

- `tsup` is configured for **ESM only** (`format: ['esm']`). Do not add a CJS target.
- `tsup` externalizes `@ai-sdk/provider`, `@ai-sdk/provider-utils`, `@ai-sdk/openai-compatible`, and `zod`. Keep them external so consumers resolve a single copy.
- `package.json` `exports` is `{ types, import, default }` with no `require` condition and no `main` field. Do not add them back.
- Pin `@ai-sdk/*` dependencies to the exact versions `ai@7` uses. Do not widen them to carets without checking the released spec.
- `tsup` injects `__PACKAGE_VERSION__` from `package.json` at build time. `src/version.ts` falls back to `'0.0.0-test'` when the define is absent (e.g. raw `tsc`).
- `bun run pack` produces a minified `.tgz` in `pack/` via `bun pm pack --destination pack`. Do not hand-edit anything in `dist/` or `pack/`.
- Bump version in `package.json` when shipping; `bun.lock` may need regenerating if deps change.

## Review Checklist (before declaring done)

- `bun run lint` passes.
- `bun run typecheck` passes (this only covers `src/`).
- `bun run test` passes.
- `bun run build` passes; `dist/` contains ESM output only and no inlined zod runtime.
- No V3 type imports or `specificationVersion = 'v3'` remain in `src/` or `tests/`.
- No unused imports/exports; new public exports added to `src/index.ts`.
- Public API surface unchanged unless the user asked for a breaking change.
- No edits to `dist/`, `pack/`, `logs/` unless explicitly requested.

## Agent Behavior

- Be concise; ask before large refactors.
- Prefer editing existing files; do not add top-level config or docs files without approval.
- Do not commit, push, or open PRs unless explicitly asked.
- Do not strip TODOs or existing comments without instruction.
- Follow patterns already in `src/` rather than inventing new ones.
