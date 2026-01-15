# AGENTS.md - Venice AI SDK Provider

This document provides guidelines for agents working on this codebase.

## Build Commands

```bash
# Build the project (outputs to dist/)
pnpm build

# Build in watch mode for development
pnpm dev

# Clean dist folder
pnpm clean

# Run a single test file
pnpm test:node -- --reporter=verbose path/to/test.test.ts
pnpm test:edge -- --reporter=verbose path/to/test.test.ts
```

## Lint & Type Check Commands

```bash
# Lint all TypeScript files
pnpm lint

# Fix linting issues automatically
pnpm lint-fix

# Type-check without emitting files
pnpm type-check

# Check code formatting
pnpm prettier-check

# Fix formatting issues
pnpm prettier-fix
```

## Test Commands

```bash
# Run all tests (node + edge)
pnpm test

# Run only Node.js runtime tests
pnpm test:node

# Run only Edge runtime tests
pnpm test:edge

# Run tests in watch mode
pnpm test:watch
```

## Code Style Guidelines

### Imports

- Use `import type` for type-only imports
- Group imports in this order:
  1. External library imports (`@ai-sdk/`, `zod`, etc.)
  2. Internal type imports (`./filename`)
  3. Internal value imports (`./filename`)
- Separate groups with blank lines

```typescript
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { loadApiKey, withoutTrailingSlash } from "@ai-sdk/provider-utils";
import { VeniceChatLanguageModel } from "./venice-chat-language-model";
```

### Naming Conventions

- **Classes**: PascalCase (`VeniceChatLanguageModel`)
- **Functions/Variables**: camelCase (`convertToVeniceChatMessages`)
- **Constants**: UPPER_SNAKE_CASE when exported, otherwise camelCase
- **Files**: kebab-case (`venice-chat-options.ts`)
- **Interfaces**: PascalCase with `V3` suffix for provider interface versions
- **Types**: PascalCase, often mirrors the interface name without `I` prefix

### TypeScript Strict Settings

This project uses strict TypeScript with these settings:

- `noUncheckedIndexedAccess`: Always use optional chaining and nullish coalescing
- `noUnusedLocals` / `noUnusedParameters`: No dead code allowed
- `noImplicitReturns`: All code paths must return
- `noImplicitOverride`: Use `override` keyword when subclassing

### Error Handling

- Use descriptive error messages with context
- Throw `Error` instances with clear messages
- Use zod for input validation (see `venice-chat-options.ts`)
- Handle null/undefined explicitly with nullish coalescing (`??`) and optional chaining (`?.`)

```typescript
// Good - explicit null handling
const value = responseBody.usage ?? null;
const modelId = response.model ?? "unknown";

// Good - descriptive errors
throw new Error(`Venice API error: ${message}`);
```

### Formatting

- **Indentation**: 2 spaces
- **Quotes**: Double quotes (`"`)
- **Semicolons**: Required
- **Trailing commas**: ES5 compatible
- **Bracket spacing**: `true`
- **Print width**: 230 characters

### Zod Schemas

- Use `z.looseObject` for API response schemas (tolerant parsing)
- Use `z.object` with `.optional()` for configuration schemas
- Include JSDoc comments on schema fields
- Use `z.infer<typeof schema>` for TypeScript types

```typescript
const veniceChatResponseSchema = z.looseObject({
  id: z.string().nullish(),
  choices: z.array(z.object({ ... })).nullish(),
});

export type VeniceChatResponse = z.infer<typeof veniceChatResponseSchema>;
```

### Switch Statements

Use exhaustive switch statements with `never` for type safety:

```typescript
switch (role) {
  case "system": { ...; break; }
  case "user": { ...; break; }
  default: {
    const _exhaustive: never = role;
    throw new Error(`Unsupported role: ${_exhaustive}`);
  }
}
```

### Async/Await

- Prefer `async/await` over Promise chains
- Always handle errors with try/catch for async operations
- Use `await` at top level, avoid unnecessary IIFEs

### General Patterns

- Private fields use `#` prefix (private class fields) or `_` prefix convention
- Getters for read-only properties
- Factory functions for creating instances (`createVenice`)
- Helper functions for conversions (`convertToVeniceChatMessages`)
- Constants defined at module level or in dedicated files

## Project Structure

```
src/
  index.ts              # Main exports
  version.ts            # VERSION constant
  venice-provider.ts    # Provider factory (createVenice)
  venice-chat-language-model.ts  # Main model implementation
  venice-chat-options.ts         # Zod schemas and types
  venice-chat-prompt.ts          # Type definitions
  convert-to-venice-chat-messages.ts  # Message conversion
```

## Configuration Files

- `tsconfig.json`: Strict TypeScript config
- `tsup.config.ts`: Bundle config (CJS + ESM)
- `.prettierrc`: Code formatting rules
- `vitest.*.config.ts`: Test configurations
