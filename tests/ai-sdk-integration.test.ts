import type { FetchFunction } from '@ai-sdk/provider-utils';
import { APICallError, embed, embedMany, experimental_decide, generateImage, generateSpeech, generateText, isStepCount, Output, streamText, tool, transcribe } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { createVenice } from '../src/venice-provider';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(...chunks: unknown[]): Response {
    const events = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
    return new Response(`${events}data: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function createTestProvider(response: () => Response, settings: { supportsStructuredOutputs?: boolean; name?: string } = {}) {
    const requests: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        requests.push(JSON.parse(String(init?.body)));
        return response();
    }) as FetchFunction;
    return { provider: createVenice({ apiKey: 'test-key', fetch, ...settings }), requests, urls };
}

function generateBody(message: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'cmpl-1',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        ...extra,
    };
}

describe('ai@7 integration', () => {
    it('generates plain text with generateText', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: 'Hello from Venice' })));

        const result = await generateText({ model: provider('test-model'), prompt: 'Say hello' });

        expect(result.text).toBe('Hello from Venice');
        expect(requests[0]?.messages).toMatchObject([{ role: 'user', content: 'Say hello' }]);
    });

    it('assembles a streamed tool call with streamText', async () => {
        const { provider } = createTestProvider(() =>
            sseResponse(
                { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'add', arguments: '' } }] } }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1,' } }] } }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"b":2}' } }] } }] },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            )
        );

        const result = streamText({
            model: provider('test-model'),
            prompt: 'Add 1 and 2',
            tools: { add: tool({ inputSchema: z.object({ a: z.number(), b: z.number() }) }) },
            stopWhen: isStepCount(1),
        });

        expect(await result.toolCalls).toEqual([expect.objectContaining({ toolName: 'add', input: { a: 1, b: 2 } })]);
    });

    it('generates an object through generateText output', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: '{"name":"Venice","population":100}' })), {
            supportsStructuredOutputs: true,
        });

        const result = await generateText({
            model: provider('test-model'),
            output: Output.object({ schema: z.object({ name: z.string(), population: z.number() }) }),
            prompt: 'Describe the city',
        });

        expect(result.output).toEqual({ name: 'Venice', population: 100 });
        expect(requests[0]?.response_format).toMatchObject({ type: 'json_schema' });
    });

    it('sends multimodal file parts as image data URLs', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: 'A tiny image' })));

        await generateText({
            model: provider('test-model'),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this' },
                        { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
                    ],
                },
            ],
        });

        const messages = requests[0]?.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
        expect(messages[0]?.content).toContainEqual(
            expect.objectContaining({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } })
        );
    });

    it('forwards a venice cacheControl alias as cache_control on a text part', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: 'ok' })));

        await generateText({
            model: provider('test-model'),
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'cache this', providerOptions: { venice: { cacheControl: { type: 'ephemeral' } } } }],
                },
            ],
        });

        const messages = requests[0]?.messages as Array<{ content: Array<{ type: string; cache_control?: unknown; cacheControl?: unknown }> }>;
        const textPart = messages[0]?.content.find((part) => part.type === 'text');

        expect(textPart?.cache_control).toEqual({ type: 'ephemeral' });
        expect(textPart).not.toHaveProperty('cacheControl');
    });

    it('forwards venice cacheControl from instructions as cache_control on the system message', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: 'ok' })));

        await generateText({
            model: provider('test-model'),
            instructions: {
                role: 'system',
                content: 'You are a careful assistant.',
                providerOptions: { venice: { cacheControl: { type: 'ephemeral' } } },
            },
            prompt: 'Summarize the document.',
        });

        type CapturedMessage = { role: string; content: Array<{ type: string; text?: string; cache_control?: unknown; cacheControl?: unknown }> };
        const messages = requests[0]?.messages as CapturedMessage[];
        const systemMessage = messages.find((message) => message.role === 'system');
        const textPart = systemMessage?.content.find((part) => part.type === 'text');

        expect(textPart?.cache_control).toEqual({ type: 'ephemeral' });
        expect(textPart).not.toHaveProperty('cacheControl');
    });

    it('forwards the top-level reasoning option as reasoning_effort', async () => {
        const { provider, requests } = createTestProvider(() => jsonResponse(generateBody({ content: 'Thinking' })));

        await generateText({ model: provider('test-model'), prompt: 'Think hard', reasoning: 'high' });

        expect(requests[0]?.reasoning_effort).toBe('high');
    });

    it('exposes web search citations as source parts', async () => {
        const { provider } = createTestProvider(() =>
            jsonResponse(
                generateBody(
                    { content: 'Venice is sinking' },
                    {
                        venice_parameters: {
                            web_search_citations: [{ title: 'Venice flooding', url: 'https://example.com/venice', content: 'Acqua alta' }],
                        },
                    }
                )
            )
        );

        const result = await generateText({ model: provider('test-model'), prompt: 'Why is Venice sinking?' });

        expect(result.sources).toEqual([
            {
                type: 'source',
                sourceType: 'url',
                id: 'venice-web-search-0',
                url: 'https://example.com/venice',
                title: 'Venice flooding',
                providerMetadata: { venice: { content: 'Acqua alta' } },
            },
        ]);
        expect(result.content).toContainEqual(expect.objectContaining({ type: 'source', url: 'https://example.com/venice' }));
        expect(result.content.find((part) => part.type === 'text')).not.toHaveProperty('citations');
    });

    it('exposes streamed web search citations as source parts', async () => {
        const { provider } = createTestProvider(() =>
            sseResponse(
                {
                    choices: [{ delta: { content: 'Venice is sinking' } }],
                    venice_parameters: { web_search_citations: [{ title: 'Venice flooding', url: 'https://example.com/venice', content: 'Acqua alta' }] },
                },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            )
        );

        const result = streamText({ model: provider('test-model'), prompt: 'Why is Venice sinking?' });
        const sources = await result.sources;

        expect(sources).toEqual([
            {
                type: 'source',
                sourceType: 'url',
                id: 'venice-web-search-0',
                url: 'https://example.com/venice',
                title: 'Venice flooding',
                providerMetadata: { venice: { content: 'Acqua alta' } },
            },
        ]);
    });
});

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('ai@7 model surfaces integration', () => {
    it('generates speech through generateSpeech', async () => {
        const { provider, requests } = createTestProvider(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));

        const result = await generateSpeech({ model: provider.speechModel('tts-model'), text: 'hello', voice: 'af_sky', outputFormat: 'mp3' });

        expect(result.audio.uint8Array).toEqual(new Uint8Array([1, 2, 3]));
        expect(requests[0]).toMatchObject({ model: 'tts-model', input: 'hello', voice: 'af_sky', response_format: 'mp3' });
    });

    it('transcribes audio through transcribe', async () => {
        const formData: FormData[] = [];
        const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            formData.push(init?.body as FormData);
            return jsonResponse({ text: 'hello world', timestamps: { segment: [{ text: 'hello world', start: 0, end: 2 }] } });
        }) as FetchFunction;
        const provider = createVenice({ apiKey: 'test-key', fetch });

        const result = await transcribe({
            model: provider.transcriptionModel('whisper-model'),
            audio: new Uint8Array([1, 2, 3]),
            timestampGranularities: ['segment'],
        });

        expect(result.text).toBe('hello world');
        expect(result.segments).toEqual([{ text: 'hello world', startSecond: 0, endSecond: 2 }]);
        expect(formData[0]?.get('timestamps')).toBe('true');
        expect(formData[0]?.get('response_format')).toBe('json');
    });

    it('generates images through generateImage with n/variants', async () => {
        const { provider, requests, urls } = createTestProvider(() => jsonResponse({ images: [PNG_BASE64, PNG_BASE64] }));

        const result = await generateImage({ model: provider.imageModel('image-model'), prompt: 'a canal', n: 2 });

        expect(result.images).toHaveLength(2);
        expect(requests[0]).toMatchObject({ prompt: 'a canal', variants: 2 });
        expect(urls[0]).toBe('https://api.venice.ai/api/v1/image/generate');
    });

    it('decides answers through experimental_decide', async () => {
        const { provider, requests } = createTestProvider(() =>
            jsonResponse({ model: 'jev-latest', answers: { urgent: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } })
        );

        const result = await experimental_decide({
            model: provider.decisionModel('jev-latest'),
            state: [{ type: 'text', text: 'The service is down.' }],
            questions: { urgent: { type: 'boolean', instructions: 'Is it urgent?' } },
        });

        expect(result.answers).toEqual({ urgent: { type: 'boolean', probability: 0.9 } });
        expect(requests[0]).toMatchObject({ model: 'jev-latest', state: 'The service is down.' });
    });

    it('reads custom provider options for speech and image models', async () => {
        const speech = createTestProvider(() => new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }), { name: 'custom' });

        await generateSpeech({
            model: speech.provider.speechModel('tts-model'),
            text: 'hello',
            providerOptions: { custom: { temperature: 0.5 } },
        });
        expect(speech.requests[0]).toMatchObject({ temperature: 0.5 });

        const image = createTestProvider(() => jsonResponse({ images: [PNG_BASE64] }), { name: 'custom' });

        await generateImage({
            model: image.provider.imageModel('image-model'),
            prompt: 'a canal',
            providerOptions: { custom: { negative_prompt: 'blurry' } },
        });
        expect(image.requests[0]).toMatchObject({ negative_prompt: 'blurry' });
    });
});

describe('ai@7 tool loop and transport integration', () => {
    it('executes a tool call and round-trips the tool result through a second request', async () => {
        const responses = [
            jsonResponse({
                id: 'cmpl-1',
                created: 1,
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } }],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            jsonResponse(generateBody({ content: 'The sum is 3' })),
        ];
        const { provider, requests } = createTestProvider(() => responses.shift() as Response);

        const executed: Array<{ a: number; b: number }> = [];
        const result = await generateText({
            model: provider('test-model'),
            prompt: 'Add 1 and 2',
            tools: {
                add: tool({
                    inputSchema: z.object({ a: z.number(), b: z.number() }),
                    execute: async ({ a, b }) => {
                        executed.push({ a, b });
                        return { sum: a + b };
                    },
                }),
            },
            stopWhen: isStepCount(2),
        });

        expect(executed).toEqual([{ a: 1, b: 2 }]);
        expect(requests).toHaveLength(2);
        expect(result.text).toBe('The sum is 3');
        expect(result.steps).toHaveLength(2);
        expect(result.steps[0]?.toolCalls).toEqual([expect.objectContaining({ toolCallId: 'call-1', toolName: 'add', input: { a: 1, b: 2 } })]);

        const secondRequestMessages = requests[1]?.messages as Array<Record<string, unknown>>;
        expect(secondRequestMessages).toContainEqual(
            expect.objectContaining({
                role: 'assistant',
                tool_calls: [expect.objectContaining({ id: 'call-1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } })],
            })
        );
        expect(secondRequestMessages).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"sum":3}' });
    });

    it('propagates provider headers, query params, and request headers', async () => {
        const captured: Array<{ url: string; headers: Headers }> = [];
        const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            captured.push({ url: String(url), headers: new Headers(init?.headers) });
            return jsonResponse(generateBody({ content: 'ok' }));
        }) as FetchFunction;
        const provider = createVenice({
            apiKey: 'test-key',
            baseURL: 'https://api.test/v1',
            headers: { 'x-provider-header': 'provider-value' },
            queryParams: { trace: 'abc' },
            fetch,
        });

        await generateText({ model: provider('test-model'), prompt: 'hi', headers: { 'x-request-header': 'request-value' } });

        expect(captured[0]?.url).toBe('https://api.test/v1/chat/completions?trace=abc');
        const headers = captured[0]?.headers;
        expect(headers?.get('authorization')).toBe('Bearer test-key');
        expect(headers?.get('x-provider-header')).toBe('provider-value');
        expect(headers?.get('x-request-header')).toBe('request-value');
        // The AI SDK composes the call-level user-agent; the provider suffix applies when the model is called directly.
        expect(headers?.get('user-agent')).toContain('ai-sdk-provider-utils/');

        await provider('test-model').doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });

        expect(captured[1]?.headers.get('user-agent')).toContain('ai-sdk/venice/');
    });

    it('propagates Venice HTTP errors as APICallError', async () => {
        const notFound = createTestProvider(() => jsonResponse({ error: 'Model not found' }, 404));
        const notFoundError = await generateText({ model: notFound.provider('missing-model'), prompt: 'hi', maxRetries: 0 }).catch((error: unknown) => error);

        expect(APICallError.isInstance(notFoundError)).toBe(true);
        expect(notFoundError).toMatchObject({ statusCode: 404, message: 'Model not found' });

        const server = createTestProvider(() => jsonResponse({ error: { message: 'Inference failed' } }, 500));
        const serverError = await generateText({ model: server.provider('test-model'), prompt: 'hi', maxRetries: 0 }).catch((error: unknown) => error);

        expect(APICallError.isInstance(serverError)).toBe(true);
        expect(serverError).toMatchObject({ statusCode: 500, message: 'Inference failed' });
    });

    it('forwards the abort signal and cancels an in-flight stream', async () => {
        const started = deferred();
        let receivedSignal: AbortSignal | null | undefined;
        const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            receivedSignal = init?.signal;
            started.resolve();
            return await new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
        }) as FetchFunction;
        const provider = createVenice({ apiKey: 'test-key', fetch });
        const controller = new AbortController();

        const result = streamText({ model: provider('test-model'), prompt: 'hi', abortSignal: controller.signal });
        const text = result.text;
        await started.promise;
        controller.abort();

        await expect(text).rejects.toThrow();
        expect(receivedSignal).toBe(controller.signal);
    });

    it('parses streamed structured output with Output.object', async () => {
        const { provider, requests } = createTestProvider(
            () =>
                sseResponse(
                    { choices: [{ delta: { content: '{"name":"Ven' } }] },
                    { choices: [{ delta: { content: 'ice","population":100}' } }] },
                    { choices: [{ delta: {}, finish_reason: 'stop' }] }
                ),
            { supportsStructuredOutputs: true }
        );

        const result = streamText({
            model: provider('test-model'),
            output: Output.object({ schema: z.object({ name: z.string(), population: z.number() }) }),
            prompt: 'Describe the city',
        });

        expect(await result.output).toEqual({ name: 'Venice', population: 100 });
        expect(requests[0]?.response_format).toMatchObject({
            type: 'json_schema',
            json_schema: { schema: expect.objectContaining({ type: 'object' }), strict: true },
        });
    });
});

const EMBEDDING_MODEL = 'text-embedding-bge-m3';

function embeddingResponse(vectors: number[][]): Response {
    return jsonResponse({
        object: 'list',
        model: EMBEDDING_MODEL,
        data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        usage: { prompt_tokens: 4, total_tokens: 4 },
    });
}

describe('ai@7 embedding integration', () => {
    it('embeds a small batch through exactly one /embeddings request', async () => {
        const { provider, requests, urls } = createTestProvider(() => embeddingResponse([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]));

        const result = await embedMany({ model: provider.embeddingModel(EMBEDDING_MODEL), values: ['first', 'second'] });

        expect(requests).toHaveLength(1);
        expect(requests[0]).toEqual({ model: EMBEDDING_MODEL, input: ['first', 'second'], encoding_format: 'float' });
        expect(urls[0]).toBe('https://api.venice.ai/api/v1/embeddings');
        expect(result.embeddings).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
        expect(result.usage).toEqual({ tokens: 4 });
    });

    it('embeds a single string through the same array payload contract', async () => {
        const { provider, requests } = createTestProvider(() => embeddingResponse([[0.7, 0.8]]));

        const result = await embed({ model: provider.embeddingModel(EMBEDDING_MODEL), value: 'hello' });

        expect(requests[0]).toEqual({ model: EMBEDDING_MODEL, input: ['hello'], encoding_format: 'float' });
        expect(result.embedding).toEqual([0.7, 0.8]);
        expect(result.usage).toEqual({ tokens: 4 });
    });
});
