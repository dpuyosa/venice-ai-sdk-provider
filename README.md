# Venice Provider for the Vercel AI SDK

The [Venice](https://venice.ai/) provider for the [Vercel AI SDK](https://ai-sdk.dev/docs) connects your app to Venice's OpenAI-compatible API. Use it with `generateText`, `streamText`, structured output, and tool calling, plus image, speech, transcription, embedding, and decision models.

> **Requires AI SDK 7** (`ai@^7`) and Node.js 24 or newer. This package is ESM-only.

## Setup

```bash
# npm
npm install ai@^7 venice-ai-sdk-provider zod

# bun
bun add ai@^7 venice-ai-sdk-provider zod

# pnpm
pnpm add ai@^7 venice-ai-sdk-provider zod
```

`zod` is a peer dependency. Get an API key from [Venice](https://venice.ai/) and add it to your environment:

```bash
export VENICE_API_KEY=your-api-key-here
```

The default `venice` instance reads `VENICE_API_KEY`.

## Quickstart

```ts
import { generateText } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { text } = await generateText({
    model: venice('venice-uncensored-1-2'),
    prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});

console.log(text);
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

## Custom provider instance

Use `createVenice` to pass credentials directly or to customize the API base URL, headers, or fetch implementation:

```ts
import { createVenice } from 'venice-ai-sdk-provider';

const venice = createVenice({
    apiKey: process.env.VENICE_API_KEY,
    // baseURL: 'https://api.venice.ai/api/v1',
    // headers: { 'X-Custom-Header': 'value' },
});

const model = venice('venice-uncensored-1-2');
```

## Models and capabilities

Model IDs are passed through unchanged, so any model in the [Venice model catalog](https://docs.venice.ai/models/overview) works. Select the model factory that matches the AI SDK call you are making:

| AI SDK use | Venice model factory |
| --- | --- |
| Text, objects, and tools | `venice(modelId)` |
| Embeddings | `venice.embeddingModel(modelId)` |
| Images and image editing | `venice.imageModel(modelId)` |
| Speech | `venice.speechModel(modelId)` |
| Transcription | `venice.transcriptionModel(modelId)` |
| Decisions (experimental) | `venice.decisionModel(modelId)` |

`venice(modelId)` is equivalent to `venice.languageModel(modelId)` and `venice.chatModel(modelId)`. The legacy `/completions` endpoint is not supported.

## Venice-specific usage

Pass Venice options under `providerOptions.venice`. Options that are not part of the typed schema are forwarded to the Venice request body as-is, so newer API fields work without a provider release.

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
console.log(result.sources);
```

Venice returns retrieved web sources, and the provider exposes them as AI SDK URL `source` parts. Use `result.sources` (or `step.sources`, or `source` parts in `fullStream`). Duplicate URLs are emitted once. The raw citations remain available as `result.providerMetadata?.venice?.webSearchCitations`.

`enableWebSearch` accepts `'off'`, `'on'`, or `'auto'`.

### Model feature suffixes

Venice lets you enable parameters directly in the model ID. Because the model string is sent unchanged, suffixes work without extra configuration:

```ts
const result = await generateText({
    model: venice('venice-uncensored-1-2:enable_web_search=auto'),
    prompt: 'What happened in AI news today?',
});
```

See [Model Feature Suffixes](https://docs.venice.ai/api-reference/endpoint/chat/model_feature_suffix) for the supported keys.

### Reasoning

Control reasoning effort with `reasoningEffort`, or use the structured `reasoning` object. Support is model-dependent; see [Reasoning Models](https://docs.venice.ai/guides/features/reasoning-models).

```ts
const result = await generateText({
    model: venice('kimi-k3-1-pro'),
    prompt: 'Prove that there are infinitely many primes.',
    providerOptions: {
        venice: {
            reasoningEffort: 'high', // 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        },
    },
});
```

The AI SDK's top-level `reasoning` option is also mapped to Venice's `reasoning_effort`; provider options take precedence when both are set. Reasoning text is exposed as AI SDK reasoning parts (`result.reasoning`, `result.reasoningText`).

### Structured output

Venice supports JSON Schema response formats. Enable structured outputs on the provider or per call:

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createVenice } from 'venice-ai-sdk-provider';

const venice = createVenice({
    apiKey: process.env.VENICE_API_KEY,
    supportsStructuredOutputs: true,
});

const { output } = await generateText({
    model: venice('z-ai-glm-5-3-flash'),
    output: Output.object({
        schema: z.object({
            name: z.string(),
            ingredients: z.array(z.string()),
        }),
    }),
    prompt: 'Generate a recipe for chocolate chip cookies.',
});

console.log(output);
```

Without `supportsStructuredOutputs` (or `providerOptions.venice.structuredOutputs: true`), the provider falls back to `response_format: { type: 'json_object' }` and emits a warning.

### Multimodal inputs

Pass images, audio, video, and documents as AI SDK `file` parts. Venice routes each media type to the corresponding content type:

- images → image content, from a URL or base64 data
- audio → audio content, from base64 data (URLs are not supported)
- video → video content, from a URL or base64 data
- other documents → file content (PDF, DOCX, PPTX, XLSX, text, Markdown, CSV, JSON, source code)

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
                    providerOptions: { venice: { imageDetail: 'high' } },
                },
            ],
        },
    ],
});
```

`imageDetail` accepts `'low'`, `'high'`, `'auto'`, or `'original'`. Use a `Uint8Array` or base64 string instead of a URL for local files.

### Venice parameters

The most commonly used `veniceParameters` are summarized below. Any other key is forwarded after converting its camelCase name to snake_case.

| Option | Type | Description |
| --- | --- | --- |
| `enableWebSearch` | `'off' \| 'on' \| 'auto'` | Enable Venice web search. |
| `enableWebScraping` | `boolean` | Scrape URLs in the latest user message. |
| `enableWebCitations` | `boolean` | Ask the model to cite web sources inline. |
| `enableXSearch` | `boolean` | Use xAI native search on supported models. |
| `stripThinkingResponse` | `boolean` | Remove `<think>` blocks from reasoning model responses. |
| `disableThinking` | `boolean` | Disable thinking on supported reasoning models. |
| `includeVeniceSystemPrompt` | `boolean` | Include Venice's built-in system prompt. **This provider defaults it to `false`; the Venice API default is `true`.** |
| `characterSlug` | `string` | Use a public Venice character persona. |

See the [Venice chat completions reference](https://docs.venice.ai/api-reference/endpoint/chat/completions) for the full parameter list.

## Images

Image generation and editing use Venice's native `/image/generate` and `/image/edit` endpoints:

```ts
import { generateImage } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const generated = await generateImage({
    model: venice.imageModel('qwen-image'),
    prompt: 'A serene canal in Venice at sunset',
    size: '1024x1024',
    providerOptions: {
        venice: {
            negative_prompt: 'low quality',
        },
    },
});

const edited = await generateImage({
    model: venice.imageModel('qwen-image-2-1-turbo-edit'),
    prompt: {
        images: [generated.image.uint8Array],
        text: 'Change the sunset to a sunrise',
    },
    providerOptions: {
        venice: {
            output_format: 'png',
        },
    },
});

console.log(edited.image.mediaType);
```

- `n` maps to Venice's `variants` (up to 4 images per call).
- `aspectRatio` takes precedence over `size`. Native `width`/`height` are capped at 1280px; larger `size` values throw. Use `aspectRatio` with the `resolution` provider option for larger images.
- `resolution` is forwarded for resolution-tier models such as `gpt-image-2` and `nano-banana-pro`, which accept `1K`, `2K`, or `4K`. Other models, such as `qwen-image`, accept `aspect_ratio` but not `resolution`.
- Image editing accepts exactly one `prompt.images` entry. Masks and multiple input images are not supported.

## Speech, transcription, and embeddings

```ts
import { embed, generateSpeech, transcribe } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { audio } = await generateSpeech({
    model: venice.speechModel('tts-kokoro'),
    text: 'Hello from Venice.',
    voice: 'af_sky',
});

const { text, segments, words } = await transcribe({
    model: venice.transcriptionModel('openai/whisper-large-v3'),
    audio: audioBytes,
    mediaType: 'audio/mpeg',
    timestampGranularities: ['word', 'segment'],
});

const { embedding } = await embed({
    model: venice.embeddingModel('text-embedding-bge-m3'),
    value: 'sunny day at the beach',
});
```

`outputFormat` for speech accepts `mp3`/`mpeg`, `wav`/`wave`, `opus`, `aac`, `flac`, and `pcm`/`pcm16`; unsupported formats fall back to `mp3` with a warning. Transcription provider options are `language` and `timestamps`.

## Decisions (experimental)

Venice's `/decisions` endpoint returns typed judgments instead of generated text:

```ts
import { experimental_decide } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { answers } = await experimental_decide({
    model: venice.decisionModel('jev-latest'),
    state: [
        {
            type: 'text',
            text: 'My payouts have failed for three days and nobody has replied. Please help as soon as possible.',
        },
    ],
    questions: {
        urgent: {
            type: 'boolean',
            instructions: 'Does this support ticket require prompt attention?',
        },
        department: {
            type: 'choice',
            instructions: 'Which team should handle this ticket?',
            criteria: {
                billing: 'Payments, invoices, or refunds',
                technical: 'Bugs, outages, or integrations',
            },
        },
    },
});

console.log(answers.urgent, answers.department);
```

Use `boolean`, `choice`, and `score` questions. `box` is not supported, and `maxOutputTokens` and `reasoning` are rejected with warnings.

## Learn more

- [Vercel AI SDK documentation](https://ai-sdk.dev/docs)
- [Venice API documentation](https://docs.venice.ai/)
- [Venice model catalog](https://docs.venice.ai/models/overview)
- [Venice privacy](https://docs.venice.ai/overview/privacy)
