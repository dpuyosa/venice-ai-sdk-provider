import type { FetchFunction } from '@ai-sdk/provider-utils';
import { generateText, isStepCount, Output, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { createVenice } from '../src/venice-provider';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sseResponse(...chunks: unknown[]): Response {
    const events = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
    return new Response(`${events}data: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function createTestProvider(response: () => Response, settings: { supportsStructuredOutputs?: boolean } = {}) {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return response();
    }) as FetchFunction;
    return { provider: createVenice({ apiKey: 'test-key', fetch, ...settings }), requests };
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

    it('exposes web search citations on the generated text part', async () => {
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

        const textPart = result.content.find((part) => part.type === 'text');
        expect(textPart?.citations).toEqual([
            {
                source: { type: 'source', sourceType: 'url', id: 'venice-web-search-0', url: 'https://example.com/venice', title: 'Venice flooding' },
                citedText: 'Acqua alta',
            },
        ]);
    });
});
