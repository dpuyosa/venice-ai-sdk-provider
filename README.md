# Venice Provider for Vercel AI SDK

The [Venice](https://venice.ai/) provider for the [Vercel AI SDK](https://sdk.vercel.ai/docs) gives access to uncensored, private AI models on the Venice API. Venice offers OpenAI-compatible endpoints with zero data retention and access to models like DeepSeek R1, Llama 3.1, Qwen, and more.

## Setup

```bash
# For bun
bun add venice-ai-sdk-provider

# For npm
npm install venice-ai-sdk-provider
```

## Provider Instance

You can import the default provider instance `venice` from `venice-ai-sdk-provider` if you have set `VENICE_API_KEY` environment variable:

```ts
import { venice } from 'venice-ai-sdk-provider';
const model = venice('venice-uncensored');
```

Or instance it manually:

```ts
import { createVenice } from 'venice-ai-sdk-provider';
const venice = createVenice({ apiKey: 'your-api-key' });
const model = venice('venice-uncensored');
```

## Example

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('venice-uncensored'),
    prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});
```

## Supported models

This list is not definitive. Venice regularly adds new models to their system. You can find the latest list of models [here](https://docs.venice.ai/models/overview).

## Venice-Specific Features

### Web Search

Enable real-time web search with citations on all Venice text models:

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('venice-uncensored'),
    prompt: 'What are the latest developments in AI?',
    providerOptions: {
        venice: {
            veniceParameters: {
                enableWebSearch: 'auto',
            },
        },
    },
});
```

### Reasoning Mode

Enable advanced step-by-step reasoning with visible thinking process:

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('qwen3-235b-a22b-thinking-2507'),
    prompt: 'Solve: If x + 2y = 10 and 3x - y = 5, what are x and y?',
    providerOptions: {
        venice: {
            veniceParameters: {
                stripThinkingResponse: false,
            },
        },
    },
});
```

#### Reasoning Effort

Control the depth of reasoning for models that support it:

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('gemini-3-pro-preview'),
    prompt: 'Prove that there are infinitely many primes',
    providerOptions: {
        venice: {
            reasoningEffort: 'high',
        },
    },
});
```

Options: `low` (fast, minimal thinking), `medium` (default, balanced), `high` (deep thinking, best for complex problems).

### Tool Calling

Venice supports function calling on compatible models:

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('qwen3-next-80b),
    tools: {
        get_weather: {
            description: 'Get current weather for a location',
            parameters: z.object({
                location: z.string().describe('City name'),
            }),
            execute: async ({ location }) => {
                return { temperature: 72, condition: 'sunny' };
            },
        },
    },
    prompt: 'What is the weather like in New York?',
});
```

### Vision

Process images with vision-compatible models. Venice supports two ways to provide images:

#### Option 1: Using image URL

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
    model: venice('mistral-31-24b'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'What do you see in this image?' },
                {
                    type: 'image_url',
                    image_url: { url: 'https://example.com/image.jpg' },
                },
            ],
        },
    ],
});
```

#### Option 2: Using image data (base64)

```ts
import { venice } from 'venice-ai-sdk-provider';
import { generateText } from 'ai';
import { readFile } from 'fs/promises';

const imageBuffer = await readFile('path/to/image.jpg');
const imageBase64 = imageBuffer.toString('base64');

const { text } = await generateText({
    model: venice('mistral-31-24b'),
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'What do you see in this image?' },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
            ],
        },
    ],
});
```

Note: Use vision-capable models like `mistral-31-24b` for image analysis.

## Embeddings

Venice supports embedding models for semantic search and RAG pipelines:

```ts
import { embed } from 'ai';
import { venice } from 'venice-ai-sdk-provider';

const { embedding } = await embed({
    model: venice.textEmbeddingModel('text-embedding-bge-m3'),
    value: 'sunny day at the beach',
});

console.log(embedding);
```

## API Key Configuration

Set your Venice API key as an environment variable:

```bash
export VENICE_API_KEY=your-api-key-here
```

Or pass it directly when creating a provider instance:

```ts
import { createVenice } from 'venice-ai-sdk-provider';

const venice = createVenice({ apiKey: 'your-api-key' });
```

## Learn More

- [Venice API Documentation](https://docs.venice.ai/)
- [Venice Models Overview](https://docs.venice.ai/models/overview)
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
