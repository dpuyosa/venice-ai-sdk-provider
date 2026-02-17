# Migration Report: v5 to v6 AI-SDK Provider Migration for Venice

## Overview

This report documents the differences between v5 (AI-SDK `@ai-sdk/provider` v2 interfaces) and current/v6 (AI-SDK `@ai-sdk/provider` v3 interfaces) for Mistral, OpenRouter, and OpenAI-compatible providers. The goal is to identify changes needed to migrate Venice (an OpenAI-compatible wrapper) from v5 to v6.

---

## Provider Comparison Summary

| Provider | v5 Interface | Current/V6 Interface |
|----------|--------------|---------------------|
| Mistral | `LanguageModelV2` | `LanguageModelV3` |
| OpenRouter | `LanguageModelV2` | `LanguageModelV3` (migrated to v3) |
| OpenAI-compatible | `LanguageModelV2` | `LanguageModelV3` |
| Venice (current) | `LanguageModelV2` | N/A - needs migration |

---

## Key Differences Between v5 and v6

### 1. Interface Version

**v5:**
```typescript
export class MistralChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';
```

**v6:**
```typescript
export class MistralChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3';
```

### 2. Finish Reason Structure

**v5:** Returns simple string
```typescript
finishReason: mapMistralFinishReason(choice.finish_reason)
// Returns: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'unknown'
```

**v6:** Returns object with unified and raw
```typescript
finishReason: {
  unified: mapMistralFinishReason(choice.finish_reason),
  raw: choice.finish_reason ?? undefined
}
// Returns: { unified: 'stop' | 'length' | ... , raw: string | undefined }
```

### 3. Warning Types

**v5:**
```typescript
warnings.push({ type: 'unsupported-setting', setting: 'topK' });
```

**v6:**
```typescript
warnings.push({ type: 'unsupported', feature: 'topK' });
// or for deprecation warnings:
warnings.push({ type: 'other', message: `The 'openai-compatible' key in providerOptions is deprecated...` });
```

### 4. Usage Format (MAJOR CHANGE)

**v5:** Flat structure (`LanguageModelV2Usage`)
```typescript
usage: {
  inputTokens: response.usage.prompt_tokens,
  outputTokens: response.usage.completion_tokens,
  totalTokens: response.usage.total_tokens,
}
```

**v6:** Nested structure (`LanguageModelV3Usage`) with sub-objects and raw data
```typescript
// OpenRouter v6 example (from build-usage.ts):
usage: {
  inputTokens: {
    total: usage.inputTokens ?? 0,
    noCache: undefined,
    cacheRead: usage.inputTokensDetails?.cachedTokens,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: usage.outputTokens ?? 0,
    text: undefined,
    reasoning: usage.outputTokensDetails?.reasoningTokens,
  },
  raw: rawUsage,  // original raw usage data
}
```

**Note:** `LanguageModelV3Usage` replaces the flat `inputTokens`/`outputTokens` numbers with sub-objects containing `total`, and breakdown fields (`noCache`, `cacheRead`, `cacheWrite` for input; `text`, `reasoning` for output). A `raw` field is also added for the original API response data.

Uses conversion helper functions:
```typescript
// Mistral
import { convertMistralUsage } from './convert-mistral-usage';
usage: convertMistralUsage(response.usage);

// OpenAI-compatible
import { convertOpenAICompatibleChatUsage } from './convert-openai-compatible-chat-usage';
usage: convertOpenAICompatibleChatUsage(responseBody.usage);
```

### 5. Zod Schema Changes

**v5 (OpenAI-compatible):**
```typescript
const openaiCompatibleTokenUsageSchema = z.object({ ... })
```

**v6 (OpenAI-compatible):**
```typescript
const openaiCompatibleTokenUsageSchema = z
  .looseObject({ ... })  // Changed from z.object to z.looseObject
```

### 6. Tool Call Handling - Extra Content Support

**v5:** Basic tool calls
```typescript
content.push({
  type: 'tool-call',
  toolCallId: toolCall.id ?? generateId(),
  toolName: toolCall.function.name,
  input: toolCall.function.arguments!,
});
```

**v6:** Added support for `extra_content` (e.g., Google thought signatures)
```typescript
const thoughtSignature = toolCall.extra_content?.google?.thought_signature;
content.push({
  type: 'tool-call',
  toolCallId: toolCall.id ?? generateId(),
  toolName: toolCall.function.name,
  input: toolCall.function.arguments!,
  ...(thoughtSignature
    ? {
        providerMetadata: {
          [this.providerOptionsName]: { thoughtSignature },
        },
      }
    : {}),
});
```

### 7. Deprecated Provider Options Handling

**v6 only:** Shows deprecation warning for old provider options key
```typescript
const deprecatedOptions = await parseProviderOptions({
  provider: 'openai-compatible',
  providerOptions,
  schema: openaiCompatibleLanguageModelChatOptions,
});

if (deprecatedOptions != null) {
  warnings.push({
    type: 'other',
    message: `The 'openai-compatible' key in providerOptions is deprecated. Use 'openaiCompatible' instead.`,
  });
}
```

### 8. Stream Handling - Reasoning End Before Text

**v5:** Did not end reasoning block before text
```typescript
if (textContent != null && textContent.length > 0) {
  if (!activeText) {
    controller.enqueue({ type: 'text-start', id: '0' });
    activeText = true;
  }
  // ... emit text
}
```

**v6:** Ends reasoning block before text starts
```typescript
if (delta.content) {
  // end active reasoning block before text starts
  if (isActiveReasoning) {
    controller.enqueue({
      type: 'reasoning-end',
      id: 'reasoning-0',
    });
    isActiveReasoning = false;
  }

  if (!isActiveText) {
    controller.enqueue({ type: 'text-start', id: 'txt-0' });
    isActiveText = true;
  }
  // ... emit text
}
```

### 9. Transform Request Body (v6 only)

**v6 OpenAI-compatible:** Added optional `transformRequestBody` config
```typescript
export type OpenAICompatibleChatConfig = {
  // ... other fields
  /**
   * Optional function to transform the request body before sending it to the API.
   * This is useful for proxy providers that may require a different request format
   * than the official OpenAI API.
   */
  transformRequestBody?: (args: Record<string, any>) => Record<string, any>;
};
```

### 10. Response Schema Changes

**Mistral v6:** Added support for `z.union([z.string(), z.number()])` in reference_ids
```typescript
// v5
reference_ids: z.array(z.number()),
// v6
reference_ids: z.array(z.union([z.string(), z.number()])),
```

### 11. Provider Interface Version Change

**v5:**
```typescript
import type { ProviderV2 } from '@ai-sdk/provider';
export interface VeniceProvider extends ProviderV2 {
```

**v6:**
```typescript
import type { ProviderV3 } from '@ai-sdk/provider';
export interface VeniceProvider extends ProviderV3 {
```

### 12. Prepare Tools Changes

**v5:**
```typescript
import type { LanguageModelV2CallOptions, LanguageModelV2CallWarning } from '@ai-sdk/provider';

if (tool.type === 'provider-defined') {
  toolWarnings.push({
    type: 'unsupported-tool',
    tool,
  });
}
```

**v6:**
```typescript
import type { LanguageModelV3CallOptions, SharedV3Warning } from '@ai-sdk/provider';

if (tool.type === 'provider') {  // 'provider-defined' -> 'provider'
  toolWarnings.push({
    type: 'unsupported',
    feature: `provider-defined tool ${tool.id}`,  // New warning format
  });
}
```

### 13. Message Conversion Changes

**v5:**
```typescript
import type { LanguageModelV2Prompt, SharedV2ProviderMetadata, LanguageModelV2DataContent } from '@ai-sdk/provider';
```

**v6:**
```typescript
import type { LanguageModelV3Prompt, SharedV3ProviderMetadata, LanguageModelV3DataContent } from '@ai-sdk/provider';
```

### 14. Usage Type Changes

**v5:**
```typescript
import type { LanguageModelV2Usage } from '@ai-sdk/provider';
export interface VeniceUsage extends LanguageModelV2Usage {
```

**v6:** Uses `LanguageModelV3Usage` (note: Venice already has extended usage with `cacheCreationInputTokens` - may need to verify compatibility)

### 15. Additional v6 Changes in OpenAI-compatible

- **`z.looseObject` for response schemas** - Venice already uses this in `venice-response.ts` (correct for v6)
- **`transformRequestBody` config option** - Optional, for proxy providers
- **`metadataExtractor` config option** - For extracting metadata from responses
- **`specificationVersion = 'v3'` on provider** - Add to provider setup

### 16. Stream-Start Event (V3 Streaming)

**v5:** No stream-start event; streaming begins directly with content parts.

**v6:** Streams must emit a `stream-start` event before any content:
```typescript
// OpenRouter v6 example (from openrouter-chat-language-model.ts):
controller.enqueue({
  type: 'stream-start',
  warnings,
});
```

This is required by `LanguageModelV3StreamPart` and must be the first event emitted in the stream.

### 17. V6 Dependency Versions

**v5 (OpenRouter):**
```json
"@ai-sdk/provider": "2.0.0",        // devDependency
"@ai-sdk/provider-utils": "3.0.1",  // devDependency
"ai": "^5.0.0"                       // peerDependency
```

**v6 (OpenRouter):**
```json
"@ai-sdk/provider": "^3.0.0",       // dependency
"@ai-sdk/provider-utils": "^4.0.0", // dependency
"ai": "^6.0.0"                       // devDependency
"zod": "^4.3.5"                      // peerDependency (Zod 4, not Zod 3)
```

**Note:** The v6 migration requires bumping `@ai-sdk/provider` from v2 to v3, `@ai-sdk/provider-utils` from v3 to v4, and Zod from v3 to v4.

### 18. Image Model Changes (if used)

OpenAI-compatible v6 has significant image model changes (image editing support). Venice uses OpenAICompatibleImageModel which will be automatically updated when the dependency is updated.

---

## OpenRouter: v5 vs Current

**Note:** OpenRouter current version has been migrated to use `LanguageModelV3` with the OpenRouter Responses API (not Chat Completions). Key changes include:

- **API Change:** Uses OpenRouter Responses API instead of Chat Completions API
- **Interface:** Migrated from `LanguageModelV2` to `LanguageModelV3`
- **Specification:** `specificationVersion = 'v3'`
- **Warning Types:** Uses `SharedV3Warning` with `{ type: 'unsupported', feature, details? }` format
- **Finish Reason:** Returns `{ unified: string, raw: string | undefined }` object
- **Streaming:** Uses Responses API event stream handling with different event types

### OpenRouter v6 Key Implementation Details

**v6 (current):**
```typescript
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolChoice,
  SharedV3Warning,
} from '@ai-sdk/provider';

export class OpenRouterChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'openrouter';
```

**Dependencies:**
- `@ai-sdk/provider`: ^3.0.0
- `@ai-sdk/provider-utils`: ^4.0.0
- `@openrouter/sdk`: ^0.3.11

**v5:**
```typescript
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  // ...
} from '@ai-sdk/provider';

export class OpenRouterChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'openrouter';
```

**v5 Dependencies:**
- `@ai-sdk/provider`: 2.0.0
- `@ai-sdk/provider-utils`: 3.0.1
- `@openrouter/sdk`: ^0.1.27

---

## Venice Migration Checklist

To migrate Venice from v5 (LanguageModelV2) to v6 (LanguageModelV3), perform the following changes:

### 1. Update Interface Implementation

```typescript
// Before
export class VeniceChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';

// After
import { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Content, LanguageModelV3FinishReason, LanguageModelV3GenerateResult, LanguageModelV3StreamPart, LanguageModelV3StreamResult, SharedV3ProviderMetadata, SharedV3Warning } from '@ai-sdk/provider';

export class VeniceChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3';
```

### 2. Update doGenerate Return Type

```typescript
// Before
async doGenerate(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>>

// After
async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult>
```

### 3. Update doStream Return Type

```typescript
// Before
async doStream(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>>

// After
async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult>
```

### 4. Update Finish Reason

```typescript
// Before
finishReason: mapOpenAICompatibleFinishReason(choice?.finish_reason) ?? 'other'

// After
finishReason: {
  unified: mapOpenAICompatibleFinishReason(choice?.finish_reason) ?? 'other',
  raw: choice?.finish_reason ?? undefined
}
```

### 5. Update Warning Type

```typescript
// Before
const warnings: LanguageModelV2CallWarning[] = [];

// After
const warnings: SharedV3Warning[] = [];
```

### 6. Update Usage Format to V3 Nested Structure

The `LanguageModelV3Usage` type has a completely different shape from V2. Update `convertVeniceChatUsage` to return the new nested format:

```typescript
// Before (V2 - flat):
return {
  inputTokens: usage.prompt_tokens ?? undefined,
  outputTokens: usage.completion_tokens ?? undefined,
  totalTokens: usage.total_tokens ?? undefined,
  cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
  cacheCreationInputTokens: usage.prompt_tokens_details?.cache_creation_input_tokens ?? undefined,
};

// After (V3 - nested with raw):
return {
  inputTokens: {
    total: usage.prompt_tokens ?? 0,
    noCache: undefined,
    cacheRead: usage.prompt_tokens_details?.cached_tokens,
    cacheWrite: usage.prompt_tokens_details?.cache_creation_input_tokens,
  },
  outputTokens: {
    total: usage.completion_tokens ?? 0,
    text: undefined,
    reasoning: usage.completion_tokens_details?.reasoning_tokens,
  },
  raw: usage, // include raw usage data
};
```

**Note:** Venice's custom `cacheCreationInputTokens` field maps to `inputTokens.cacheWrite` in V3. The `VeniceUsage` interface must be updated to extend `LanguageModelV3Usage` instead of `LanguageModelV2Usage`.

### 7. Update Provider Metadata Type

```typescript
// Before
const providerMetadata: SharedV2ProviderMetadata = { ... }

// After
const providerMetadata: SharedV3ProviderMetadata = { ... }
```

### 8. Add Deprecated Provider Options Warning (Optional)

Add handling for deprecated 'openai-compatible' key in providerOptions.

### 9. Update Stream Reasoning Handling

Ensure reasoning block is ended before text starts in streaming mode:
```typescript
if (delta.content) {
  // end active reasoning block before text starts
  if (isActiveReasoning) {
    controller.enqueue({
      type: 'reasoning-end',
      id: 'reasoning-0',
    });
    isActiveReasoning = false;
  }
  // ... rest of text handling
}
```

### 10. Update Error Finish Reason

```typescript
// Before
finishReason = 'error';

// After
finishReason = { unified: 'error', raw: undefined };
```

### 11. Add Transform Request Body Support (Optional)

Add the optional `transformRequestBody` configuration option to VeniceChatConfig.

### 12. Update Provider Interface

```typescript
// Before
import type { ProviderV2 } from '@ai-sdk/provider';
export interface VeniceProvider extends ProviderV2 {

// After
import type { ProviderV3 } from '@ai-sdk/provider';
export interface VeniceProvider extends ProviderV3 {
```

### 13. Add specificationVersion to Provider

```typescript
// Add to createVenice function after provider creation
provider.specificationVersion = 'v3' as const;
```

### 14. Update Prepare Tools

```typescript
// Before
import type { LanguageModelV2CallOptions, LanguageModelV2CallWarning } from '@ai-sdk/provider';

if (tool.type === 'provider-defined') {
  toolWarnings.push({
    type: 'unsupported-tool',
    tool,
  });
}

// After
import type { LanguageModelV3CallOptions, SharedV3Warning } from '@ai-sdk/provider';

if (tool.type === 'provider') {  // Renamed from 'provider-defined'
  toolWarnings.push({
    type: 'unsupported',
    feature: `provider-defined tool ${tool.id}`,  // New format
  });
}
```

### 15. Update Message Conversion Types

```typescript
// Before
import type { LanguageModelV2Prompt, SharedV2ProviderMetadata, LanguageModelV2DataContent } from '@ai-sdk/provider';

// After
import type { LanguageModelV3Prompt, SharedV3ProviderMetadata, LanguageModelV3DataContent } from '@ai-sdk/provider';
```

### 16. Update Usage Type

```typescript
// Before
import type { LanguageModelV2Usage } from '@ai-sdk/provider';

// After (verify compatibility - Venice has extended fields)
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
```

### 17. Add stream-start Event to doStream

V3 streaming requires emitting a `stream-start` event as the first item:
```typescript
// Before (v5): streaming starts directly with content parts

// After (v6): emit stream-start before any content
controller.enqueue({
  type: 'stream-start',
  warnings,
});
```

### 18. Update Dependencies (package.json)

```json
// Before
"@ai-sdk/provider": "^2.0.1",
"@ai-sdk/provider-utils": "^3.0.20"

// After
"@ai-sdk/provider": "^3.0.0",
"@ai-sdk/provider-utils": "^4.0.0"
```

Also update Zod peer dependency if applicable (v3 -> v4).

---

## Files to Create/Modify for Venice Migration

1. **Modify:** `src/venice-provider.ts` - ProviderV2 → ProviderV3, add specificationVersion
2. **Modify:** `src/venice-chat-language-model.ts` - Main implementation (see checklist items 1-11)
3. **Modify:** `src/venice-chat-options.ts` - May need schema updates (add strictJsonSchema option)
4. **Modify:** `src/venice-prepare-tools.ts` - Update tool type check and warning format
5. **Modify:** `src/convert-to-venice-chat-messages.ts` - Update V2 types to V3
6. **Modify:** `src/venice-chat-usage.ts` - Update LanguageModelV2Usage to LanguageModelV3Usage
7. **Modify:** `src/venice-chat-message.ts` - Update any V2 type imports

---

## Testing Recommendations

1. Test non-streaming chat completion
2. Test streaming chat completion
3. Test reasoning content handling
4. Test tool calls
5. Test usage accounting
6. Test provider metadata
7. Test error handling

---

## Venice Current State Analysis

### Current Dependencies (package.json)
```json
"dependencies": {
  "@ai-sdk/openai-compatible": "^1.0.32",  // v5
  "@ai-sdk/provider": "^2.0.1",              // v2
  "@ai-sdk/provider-utils": "^3.0.20"        // v3
}
```

### What Venice Already Has (v6-compatible)
- ✅ Uses `z.looseObject` in `venice-response.ts`
- ✅ Has `extra_content.google.thought_signature` support in response schema
- ✅ Has `reasoning_content` and `reasoning` in response schema
- ✅ Has tool call handling with thought signatures in `venice-chat-language-model.ts`
- ✅ Has reasoning-end before text-start in streaming
- ✅ Has usage conversion helper (`convertVeniceChatUsage`)
- ✅ Has Venice-specific usage extension with `cacheCreationInputTokens`

### What Venice Needs to Change
- ❌ Currently implements `LanguageModelV2` - needs to implement `LanguageModelV3`
- ❌ Returns plain string finish reason - needs `{ unified, raw }` object
- ❌ Uses V2 type imports throughout
- ❌ Provider extends `ProviderV2` - needs to extend `ProviderV3`
- ❌ Uses old warning format (`unsupported-tool`) - needs new format (`unsupported`)
- ❌ Uses `tool.type === 'provider-defined'` - needs `tool.type === 'provider'`
- ❌ Usage format is flat (`LanguageModelV2Usage`) - needs nested V3 format with `inputTokens: { total, noCache, cacheRead, cacheWrite }`, `outputTokens: { total, text, reasoning }`, and `raw`
- ❌ Missing `stream-start` event in doStream (required by V3)
- ❌ Dependencies need bumping: `@ai-sdk/provider` ^2 → ^3, `@ai-sdk/provider-utils` ^3 → ^4

---

## Summary

The migration from v5 to v6 involves:
- Changing the implemented interface from `LanguageModelV2` to `LanguageModelV3`
- Updating return types for `doGenerate` and `doStream`
- Converting finish reason from string to object `{ unified, raw }`
- Converting warnings from `{ type: 'unsupported-tool', tool }` to `{ type: 'unsupported', feature }`
- **Restructuring usage format** from flat (`{ inputTokens, outputTokens, totalTokens }`) to nested V3 (`{ inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning }, raw }`)
- Updating provider metadata types (V2 → V3)
- Adding reasoning-end before text-start in streaming (Venice already has this)
- Supporting `extra_content` for tool calls (Venice already has this)
- Updating provider interface from ProviderV2 to ProviderV3
- **Adding `stream-start` event** as first emission in doStream
- **Bumping dependencies**: `@ai-sdk/provider` ^2 → ^3, `@ai-sdk/provider-utils` ^3 → ^4

Venice should follow the pattern used in the OpenAI-compatible provider v6 implementation since Venice is an OpenAI-compatible wrapper. The OpenRouter v6 provider (which uses the Responses API and `LanguageModelV3`) also serves as a useful reference for the V3 interface shape, particularly for usage format and stream events.
