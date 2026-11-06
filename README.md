# Venice Provider for the Vercel AI SDK

The [Venice](https://venice.ai/) provider for the [Vercel AI SDK](https://sdk.vercel.ai/docs) gives you access to Venice's OpenAI-compatible API from `generateText`, `streamText`, `generateObject`, `generateImage`, `embed`, and `embedMany`.

Venice offers privacy tiers ranging from anonymized third-party routing to private zero-data-retention models, plus TEE and E2EE models. See [Venice privacy](https://docs.venice.ai/overview/privacy) for the details.

> **Requires AI SDK 7** (`ai@^7`) and Node.js 24 or newer. This package is ESM-only.

## Installation

```bash
# npm
npm install ai@^7 venice-ai-sdk-provider zod

# bun
bun add ai@^7 venice-ai-sdk-provider zod

# pnpm
pnpm add ai@^7 venice-ai-sdk-provider zod
```

## Provider instance

The default `venice` instance reads `VENICE_API_KEY` from the environment:

```ts
import { venice } from 'venice-ai-sdk-provider';

const model = venice('venice-uncensored-1-2');
```

Or create a configured instance:

```ts
import { createVenice } from 'venice-ai-sdk-provider';

const venice = createVenice({
    apiKey: process.env.VENICE_API_KEY,
});

const model = venice('venice-uncensored-1-2');
```

## Quick start

```ts
import { generateText } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { text, usage, finalStep } = await generateText({
    model: venice('venice-uncensored-1-2'),
    prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});

console.log(text);
console.log(usage.inputTokens, usage.outputTokens);
console.log(finalStep.providerMetadata?.venice?.cost);
```

Streaming works the same way:

```ts
import { streamText } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const result = streamText({
    model: venice('venice-uncensored-1-2'),
    prompt: 'Explain why the sky is blue.',
});

for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
}
```

## Models

Model IDs are passed through unchanged, so any model listed by Venice works, including traits and compatibility mappings. See the [Venice model catalog](https://docs.venice.ai/models/overview) for the current list.

Useful current IDs:

| Use case | Model ID |
| --- | --- |
| General chat, uncensored | `venice-uncensored-1-2` |
| Fast reasoning and tools | `z-ai-glm-5-3-flash` |
| Vision | `qwen3-vl-235b-a22b` |
| Low cost | `nvidia-nemotron-3-nano-30b-a3b` |
| Embeddings | `text-embedding-bge-m3` |

### Model feature suffixes

Venice lets you enable `venice_parameters` directly in the model ID. Because the model string is sent as-is, suffixes work without extra configuration:

```ts
const result = await generateText({
    model: venice('venice-uncensored-1-2:enable_web_search=auto'),
    prompt: 'What happened in AI news today?',
});
```

See [Model Feature Suffixes](https://docs.venice.ai/api-reference/endpoint/chat/model_feature_suffix) for the supported keys.

## Venice-specific features

Venice-specific options go under `providerOptions.venice`. The deprecated `openai-compatible` key is still parsed for backwards compatibility, but emits a warning.

### Web search and citations

```ts
import { generateText } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const result = await generateText({
    model: venice('venice-uncensored-1-2'),
    prompt: 'What are the latest developments in AI?',
    providerOptions: {
        venice: {
            veniceParameters: {
                enableWebSearch: 'auto',
                enableWebCitations: true,
            },
        },
    },
});

console.log(result.text);
console.log(result.finalStep.providerMetadata?.venice?.webSearchCitations);
```

Citations are exposed both in `providerMetadata.venice.webSearchCitations` (the raw Venice payload) and on the generated text part as `citations` (`result.content` text parts, and the `text-end` stream part when streaming).

`enableWebSearch` accepts `'off'`, `'on'`, or `'auto'`. `enableWebCitations` requests `^1^`-style inline citations.

### `veniceParameters`

| Option | Type | Description |
| --- | --- | --- |
| `enableWebSearch` | `'off' \| 'on' \| 'auto'` | Enable Venice web search. |
| `enableWebScraping` | `boolean` | Scrape URLs in the latest user message via Firecrawl. |
| `enableWebCitations` | `boolean` | Ask the model to cite web sources inline. |
| `enableXSearch` | `boolean` | Use xAI native search (web + X/Twitter) on supported models. |
| `enableE2ee` | `boolean` | Allow E2EE on E2EE-capable models when E2EE headers are present. This provider does not implement client-side E2EE. |
| `stripThinkingResponse` | `boolean` | Remove `<think>` blocks from reasoning model responses. |
| `disableThinking` | `boolean` | Disable thinking on supported reasoning models. |
| `includeVeniceSystemPrompt` | `boolean` | Include Venice's built-in system prompt. **This provider defaults it to `false`; the Venice API default is `true`.** |
| `characterSlug` | `string` | Use a public Venice character persona. |
| `includeSearchResultsInStream` | `boolean` | Emit search results in the first stream chunk (experimental). |
| `returnSearchResultsAsDocuments` | `boolean` | Surface search results as a `venice_web_search_documents` tool call for LangChain-style consumers. |

Unlisted `veniceParameters` keys are preserved and sent as-is: any extra key is forwarded after converting its name from `camelCase` to `snake_case`, so newer Venice parameters work without a provider release.

### Reasoning

Control reasoning effort with either the OpenAI-compatible `reasoningEffort` option or the structured `reasoning` object:

```ts
const result = await generateText({
    model: venice('z-ai-glm-5-3-flash'),
    prompt: 'Prove that there are infinitely many primes.',
    providerOptions: {
        venice: {
            reasoningEffort: 'high',
        },
    },
});
```

Supported effort values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Support is model-dependent; see [Reasoning Models](https://docs.venice.ai/guides/features/reasoning-models).

The AI SDK top-level `reasoning` setting is also mapped to `reasoning_effort`; provider options take precedence when both are set.

The structured form also exposes `enabled` and `summary`:

```ts
providerOptions: {
    venice: {
        reasoning: {
            effort: 'medium',
            enabled: true,
            summary: 'detailed',
        },
    },
},
```

Reasoning text is exposed as AI SDK reasoning parts (`result.reasoning`, `result.reasoningText`) and in provider metadata as `reasoningDetails`, `reasoningEncrypted`, and `thoughtSignature` for round-tripping.

### Structured output

Venice supports JSON Schema response formats. Enable structured outputs on the provider or per call:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { createVenice } from 'venice-ai-sdk-provider';

const venice = createVenice({
    apiKey: process.env.VENICE_API_KEY,
    supportsStructuredOutputs: true,
});

const { object } = await generateObject({
    model: venice('z-ai-glm-5-3-flash'),
    schema: z.object({
        name: z.string(),
        ingredients: z.array(z.string()),
    }),
    prompt: 'Generate a recipe for chocolate chip cookies.',
});
```

Without `supportsStructuredOutputs` (or `providerOptions.venice.structuredOutputs: true`), the provider falls back to `response_format: { type: 'json_object' }` and emits a warning.

### Tool calling

```ts
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { venice } from 'venice-ai-sdk-provider';

const result = await generateText({
    model: venice('z-ai-glm-5-3-flash'),
    tools: {
        getWeather: tool({
            description: 'Get current weather for a location',
            inputSchema: z.object({
                location: z.string().describe('City name'),
            }),
            execute: async ({ location }) => {
                return { temperature: 72, condition: 'sunny', location };
            },
        }),
    },
    stopWhen: isStepCount(2),
    prompt: 'What is the weather like in New York?',
});
```

Function tools, parallel tool calls, `tool_choice`, and strict schemas are supported. Venice's native search is enabled through `veniceParameters.enableWebSearch` / `enableXSearch`.

### Multimodal inputs

Pass images, audio, video, and documents as AI SDK `file` parts. Venice routes each media type to the corresponding content type:

- images → `image_url` (URL or base64)
- audio → `input_audio` (base64 only, no URLs)
- video → `video_url` (URL or base64)
- other documents → `file` (PDF, DOCX, PPTX, XLSX, text, Markdown, CSV, JSON, source code)

#### Images

```ts
import { generateText } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const result = await generateText({
    model: venice('qwen3-vl-235b-a22b'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'What do you see in this image?' },
                {
                    type: 'file',
                    mediaType: 'image/jpeg',
                    data: new URL('https://example.com/image.jpg'),
                },
            ],
        },
    ],
});
```

Use a `Uint8Array` or base64 string instead of a URL for local images.

Set the image detail level per part with `providerOptions`. Supported values are `low`, `high`, `auto`, and `original`:

```ts
{
    type: 'file',
    mediaType: 'image/jpeg',
    data: new URL('https://example.com/image.jpg'),
    providerOptions: { venice: { imageDetail: 'high' } },
}
```

`imageDetail` is sent as `image_url.detail` and is not leaked onto the outer content part.

#### Audio

```ts
import { readFile } from 'node:fs/promises';

const audio = await readFile('path/to/audio.mp3');

const result = await generateText({
    model: venice('gemini-3-flash-preview'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'Transcribe this audio.' },
                { type: 'file', mediaType: 'audio/mpeg', data: audio },
            ],
        },
    ],
});
```

#### Video

```ts
const result = await generateText({
    model: venice('gemini-3-flash-preview'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'Describe this video.' },
                {
                    type: 'file',
                    mediaType: 'video/mp4',
                    data: new URL('https://example.com/video.mp4'),
                },
            ],
        },
    ],
});
```

#### Documents

```ts
const pdf = await readFile('path/to/document.pdf');

const result = await generateText({
    model: venice('z-ai-glm-5-3-flash'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'Summarize this document.' },
                {
                    type: 'file',
                    mediaType: 'application/pdf',
                    data: pdf,
                    filename: 'document.pdf',
                },
            ],
        },
    ],
});
```

### Character personas

```ts
const result = await generateText({
    model: venice('venice-uncensored-1-2'),
    prompt: 'Introduce yourself.',
    providerOptions: {
        venice: {
            veniceParameters: {
                characterSlug: 'venice',
            },
        },
    },
});
```

Browse characters with `GET /characters` or on [venice.ai](https://venice.ai/).

### Prompt caching

Pass an OpenAI-compatible cache key and retention policy:

```ts
const result = await generateText({
    model: venice('z-ai-glm-5-3-flash'),
    prompt: longPrompt,
    providerOptions: {
        venice: {
            promptCacheKey: 'support-agent-v1',
            promptCacheRetention: '24h',
        },
    },
});
```

`promptCacheRetention` accepts `default`, `extended`, or `24h`. Cache reads and writes are reported in AI SDK usage as `usage.inputTokenDetails.cacheReadTokens` / `cacheWriteTokens`; the provider maps Venice's `cached_tokens` and `cache_creation_input_tokens` fields.

### Sampling and generation options

In addition to the standard AI SDK settings (`temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`, `maxOutputTokens`), the provider accepts:

| Option | Type | Notes |
| --- | --- | --- |
| `maxCompletionTokens` | `number` | Preferred over the deprecated `maxTokens`. |
| `maxTokens` | `number` | Sent as `max_completion_tokens`. |
| `minP` | `number` | Minimum probability threshold. |
| `maxTemp` / `minTemp` | `number` | Dynamic temperature scaling. |
| `repetitionPenalty` | `number` | Values above 1 discourage repetition. |
| `stopTokenIds` | `number[]` | Stop token IDs. |
| `logprobs` / `topLogprobs` | `boolean` / `number` | Log probability output. |
| `n` | `number` | Requested choices. The adapter reduces this to 1 and warns; use separate calls for multiple completions. |
| `parallelToolCalls` | `boolean` | Allow parallel tool calls. |
| `structuredOutputs` | `boolean` | Per-call override for JSON Schema output. |
| `strictJsonSchema` | `boolean` | Defaults to `true` when structured outputs are enabled. |
| `user` | `string` | Accepted by Venice but discarded; use `anonUserId` for attribution. |
| `anonUserId` | `string` | End-user attribution ID, sent as `anon_user_id`. |
| `fallbacks` | `Array<{ model: string }>` | Anthropic beta parameter for server-side refusal fallback on supported Claude models. Forwarded only on direct Anthropic routes; ignored for other providers. |
| `metadata` | `Record<string, string>` | OpenAI-compatible metadata parameter for request tracking. |
| `include` | `string[]` | OpenAI-compatible parameter specifying additional data to include in the response. |
| `store` | `boolean` | Accepted for OpenAI compatibility but **not used by Venice**; it does not enable response storage. |

## Images

Text-to-image generation uses Venice's OpenAI-compatible `/images/generations` endpoint:

```ts
import { generateImage } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { images } = await generateImage({
    model: venice.imageModel('qwen-image'),
    prompt: 'A serene canal in Venice at sunset',
    size: '1024x1024',
    providerOptions: {
        venice: {
            output_format: 'png',
        },
    },
});

console.log(images[0]?.mediaType);
```

The OpenAI-compatible endpoint supports `size`, `background` (`transparent` / `opaque` / `auto`), `moderation` (`low` / `auto`), `output_format` (`jpeg` / `png` / `webp`), and `anon_user_id` via `providerOptions.venice`.

Limitations of this adapter:

- `aspectRatio` and `seed` are not forwarded; the shared OpenAI-compatible image model warns and drops them.
- Venice-only parameters such as `negative_prompt`, `style_preset`, `resolution`, `quality`, `cfg_scale`, `enhance_prompt`, and `transparent_background` are not exposed. Some can be sent by hand through `providerOptions.venice` only if the OpenAI-compatible endpoint accepts them.
- Image editing, multi-image editing, upscaling, and background removal are not implemented. Use Venice's native `/image/edit`, `/image/multi-edit`, `/image/upscale`, and `/image/background-remove` endpoints directly.

## Embeddings

```ts
import { embed, embedMany } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { embedding } = await embed({
    model: venice.embeddingModel('text-embedding-bge-m3'),
    value: 'sunny day at the beach',
});

const { embeddings } = await embedMany({
    model: venice.embeddingModel('text-embedding-bge-m3'),
    values: ['first document', 'second document'],
});
```

## Provider configuration

`createVenice` accepts:

| Option | Default | Description |
| --- | --- | --- |
| `name` | `'venice'` | Provider name used in metadata and provider options keys. |
| `apiKey` | `process.env.VENICE_API_KEY` | API key. |
| `baseURL` | `'https://api.venice.ai/api/v1'` | API base URL. |
| `headers` | `{}` | Extra request headers. |
| `queryParams` | — | Extra URL query parameters. |
| `fetch` | global `fetch` | Custom fetch implementation. |
| `includeUsage` | `false` | Request usage in streaming responses. |
| `supportsStructuredOutputs` | `false` | Send JSON Schema response formats instead of `json_object`. |
| `supportedUrls` | Venice defaults | URL patterns the AI SDK may pass through instead of downloading. |
| `metadataExtractor` | Venice extractor | Custom extraction of cost, citations, and reasoning metadata. |
| `transformRequestBody` | — | Last-chance transform of the request body. |
| `convertUsage` | Venice converter | Custom usage mapping. |

Provider methods:

```ts
venice(modelId);                 // chat model
venice.languageModel(modelId);   // chat model
venice.chatModel(modelId);       // chat model
venice.embeddingModel(modelId);  // embeddings
venice.textEmbeddingModel(modelId); // deprecated alias
venice.imageModel(modelId);      // text-to-image
```

### Advanced: pass-through body parameters

Provider options that are not in the typed schema are forwarded to the request body verbatim. Use snake_case names:

```ts
providerOptions: {
    venice: {
        logit_bias: { '50256': -100 },
        top_a: 0.2,
    },
},
```

This is how you reach newer Venice fields that the typed schema does not cover yet.

## What is supported

| Venice API area | Status |
| --- | --- |
| Chat Completions (streaming, tools, structured output, reasoning, multimodal, files) | Supported |
| Venice parameters, model feature suffixes, prompt caching | Supported |
| Cost, citations, and reasoning metadata | Supported |
| Embeddings | Supported |
| Image generation (OpenAI-compatible) | Supported |
| Image editing, multi-edit, upscaling, background removal | Not implemented |
| Speech synthesis (`/audio/speech`) | Not implemented |
| Transcription (`/audio/transcriptions`) | Not implemented |
| Video generation, music/SFX, voice cloning, voice changer | Not implemented |
| Responses API (`/responses`) | Not implemented |
| Decisions API (`/decisions`) | Not implemented |
| Models, characters, billing, API keys, x402, crypto RPC | Not implemented |

## API key configuration

Set the key in the environment:

```bash
export VENICE_API_KEY=your-api-key-here
```

Or pass it directly:

```ts
const venice = createVenice({ apiKey: 'your-api-key' });
```

## Learn more

- [Venice API documentation](https://docs.venice.ai/)
- [Venice model catalog](https://docs.venice.ai/models/overview)
- [Venice chat completions reference](https://docs.venice.ai/api-reference/endpoint/chat/completions)
- [Vercel AI SDK documentation](https://sdk.vercel.ai/docs)
