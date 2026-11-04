import { InvalidResponseDataError } from '@ai-sdk/provider';
import type { LanguageModelV3CallOptions, LanguageModelV3Content, LanguageModelV3Prompt, LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { convertToVeniceChatMessages } from '../src/convert-to-venice-chat-messages';
import type { VeniceChatConfig } from '../src/venice-chat-language-model';
import { VeniceChatLanguageModel } from '../src/venice-chat-language-model';
import { createVeniceMetadataExtractor } from '../src/venice-metadata-extractor';
import { createVenice } from '../src/venice-provider';

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sseResponse(...chunks: unknown[]): Response {
    const events = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
    return new Response(`${events}data: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function createFetch(response: () => Response) {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return response();
    }) as FetchFunction;
    return { fetch, requests };
}

function createModel(response: () => Response, config: Partial<VeniceChatConfig> = {}) {
    const { fetch, requests } = createFetch(response);
    const model = new VeniceChatLanguageModel('test-model', {
        provider: 'venice.chat',
        headers: () => ({}),
        url: () => 'https://api.test/v1/chat/completions',
        fetch,
        metadataExtractor: createVeniceMetadataExtractor('venice'),
        ...config,
    });
    return { model, requests };
}

function generateBody(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        id: 'cmpl-1',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
        ...extra,
    };
}

async function collectStream(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
    const parts: LanguageModelV3StreamPart[] = [];
    for await (const part of stream) parts.push(part);
    return parts;
}

const types = (parts: LanguageModelV3StreamPart[]) => parts.map((part) => part.type);

const emptyUsage = (raw: LanguageModelV3Usage['raw']): LanguageModelV3Usage => ({
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    raw,
});

describe('VeniceChatLanguageModel doGenerate', () => {
    it('emits reasoning content before text content', async () => {
        const { model } = createModel(() => jsonResponse(generateBody({ content: 'answer', reasoning_content: 'thinking' })));

        const result = await model.doGenerate({ prompt });

        expect(result.content.map((part) => part.type)).toEqual(['reasoning', 'text']);
    });

    it('converts array content into reasoning and text parts', async () => {
        const { model } = createModel(() =>
            jsonResponse(
                generateBody({
                    content: [
                        { type: 'thinking', thinking: [{ type: 'text', text: 'deep ' }, { type: 'text', text: 'thought' }] },
                        { type: 'text', text: 'answer' },
                    ],
                })
            )
        );

        const result = await model.doGenerate({ prompt });

        expect(result.content).toEqual([
            { type: 'reasoning', text: 'deep thought' },
            { type: 'text', text: 'answer' },
        ]);
    });

    it('throws InvalidResponseDataError when the response has no choices', async () => {
        const { model } = createModel(() => jsonResponse({ id: 'cmpl-1', choices: [] }));

        await expect(model.doGenerate({ prompt })).rejects.toBeInstanceOf(InvalidResponseDataError);
    });

    it('attaches reasoning details and thought signature to the reasoning part', async () => {
        const reasoningDetails = [{ type: 'reasoning.text', text: 'thinking' }];
        const { model } = createModel(() =>
            jsonResponse(generateBody({ content: 'answer', reasoning_content: 'thinking', reasoning_details: reasoningDetails, thought_signature: 'sig-msg' }))
        );

        const result = await model.doGenerate({ prompt });

        const reasoningPart = result.content.find((part) => part.type === 'reasoning');
        expect(reasoningPart?.providerMetadata).toEqual({ venice: { reasoningDetails, thoughtSignature: 'sig-msg' } });
    });

    it('attaches reasoning details to the first tool call when there is no reasoning text', async () => {
        const reasoningDetails = [{ type: 'reasoning.text', text: 'thinking' }];
        const { model } = createModel(() =>
            jsonResponse(
                generateBody({
                    reasoning_details: reasoningDetails,
                    tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
                })
            )
        );

        const result = await model.doGenerate({ prompt });

        const toolPart = result.content.find((part) => part.type === 'tool-call');
        expect(toolPart?.providerMetadata).toEqual({ venice: { reasoningDetails } });
    });

    it('attaches thought signature to the tool call part', async () => {
        const { model } = createModel(() =>
            jsonResponse(
                generateBody({
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            extra_content: { google: { thought_signature: 'sig-tool' } },
                            function: { name: 'lookup', arguments: '{}' },
                        },
                    ],
                })
            )
        );

        const result = await model.doGenerate({ prompt });

        const toolPart = result.content.find((part) => part.type === 'tool-call');
        expect(toolPart?.providerMetadata).toEqual({ venice: { thoughtSignature: 'sig-tool' } });
    });

    it('attaches the message thought signature to the text part', async () => {
        const { model } = createModel(() => jsonResponse(generateBody({ content: 'answer', thought_signature: 'sig-msg' })));

        const result = await model.doGenerate({ prompt });

        const textPart = result.content.find((part) => part.type === 'text');
        expect(textPart?.providerMetadata).toEqual({ venice: { thoughtSignature: 'sig-msg' } });
    });

    it('merges extracted metadata with prediction token details', async () => {
        const { model } = createModel(() =>
            jsonResponse(
                generateBody(
                    { content: 'answer' },
                    {
                        cost: { diem: 0.01, usd: 0.02 },
                        usage: { completion_tokens_details: { accepted_prediction_tokens: 3, rejected_prediction_tokens: 1 } },
                    }
                )
            )
        );

        const result = await model.doGenerate({ prompt });

        expect(result.providerMetadata).toEqual({
            venice: { cost: { diem: 0.01, usd: 0.02 }, acceptedPredictionTokens: 3, rejectedPredictionTokens: 1 },
        });
    });

    it('preserves Venice-specific request body options', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        const result = await model.doGenerate({
            prompt,
            topK: 40,
            maxOutputTokens: 100,
            providerOptions: { venice: { n: 2, veniceParameters: { enableWebSearch: 'on' } } },
        });

        const body = requests[0] ?? {};
        expect(body.top_k).toBe(40);
        expect(body.n).toBe(1);
        expect(body.max_completion_tokens).toBe(100);
        expect(body.venice_parameters).toMatchObject({ enable_web_search: 'on' });
        expect(result.warnings.some((warning) => warning.type === 'other')).toBe(true);
    });
});

describe('VeniceChatLanguageModel doStream', () => {
    it('attaches reasoning metadata to the reasoning-end part', async () => {
        const reasoningDetails = [{ type: 'reasoning.text', text: 'thinking' }];
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { reasoning_content: 'thinking', reasoning_details: reasoningDetails, reasoning_encrypted: true } }] },
                { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        const reasoningEnd = parts.find((part) => part.type === 'reasoning-end');
        expect(reasoningEnd?.providerMetadata).toEqual({ venice: { reasoningDetails, reasoningEncrypted: true } });
    });

    it('closes an active text block before a later reasoning delta', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { content: 'answer' } }] },
                { choices: [{ delta: { reasoning_content: 'rethinking' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(types(parts)).toEqual([
            'stream-start',
            'response-metadata',
            'text-start',
            'text-delta',
            'text-end',
            'reasoning-start',
            'reasoning-delta',
            'reasoning-end',
            'finish',
        ]);
    });

    it('keeps the reasoning block open for an empty tool_calls array', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { reasoning_content: 'a' } }] },
                { choices: [{ delta: { tool_calls: [] } }] },
                { choices: [{ delta: { reasoning_content: 'b' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(parts.filter((part) => part.type === 'reasoning-start')).toHaveLength(1);
        expect(parts.filter((part) => part.type === 'reasoning-end')).toHaveLength(1);
        expect(parts.filter((part) => part.type === 'reasoning-delta').map((part) => (part.type === 'reasoning-delta' ? part.delta : ''))).toEqual(['a', 'b']);
    });

    it('streams tool calls with thought signature provider metadata', async () => {
        const { model } = createModel(() =>
            sseResponse(
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call-1',
                                        type: 'function',
                                        extra_content: { google: { thought_signature: 'sig-tool' } },
                                        function: { name: 'lookup', arguments: '{"a":1}' },
                                    },
                                ],
                            },
                        },
                    ],
                },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(types(parts)).toContain('tool-input-start');
        const toolCall = parts.find((part) => part.type === 'tool-call');
        expect(toolCall).toMatchObject({ toolCallId: 'call-1', toolName: 'lookup', input: '{"a":1}' });
        expect(toolCall?.providerMetadata).toEqual({ venice: { thoughtSignature: 'sig-tool' } });
    });

    it('attaches reasoning details to the first tool call when there is no reasoning text', async () => {
        const reasoningDetails = [{ type: 'reasoning.text', text: 'thinking' }];
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { reasoning_details: reasoningDetails } }] },
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
                            },
                        },
                    ],
                },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        const toolCall = parts.find((part) => part.type === 'tool-call');
        expect(toolCall?.providerMetadata).toEqual({ venice: { reasoningDetails } });
    });

    it('buffers tool call arguments until the function name arrives', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { arguments: '{"a"' } }] } }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'lookup', arguments: ':1}' } }] } }] },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        const toolCall = parts.find((part) => part.type === 'tool-call');
        expect(toolCall).toMatchObject({ toolCallId: 'call-1', toolName: 'lookup', input: '{"a":1}' });
    });

    it('throws when a tool call never receives a function name', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { arguments: '{}' } }] } }] },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            )
        );

        await expect(collectStream((await model.doStream({ prompt })).stream)).rejects.toThrow("Expected 'function.name' to be a string.");
    });

    it('emits an error when the stream ends without a finish reason', async () => {
        const { model } = createModel(() => sseResponse({ choices: [{ delta: { content: 'answer' } }] }));

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(parts.some((part) => part.type === 'error')).toBe(true);
        expect(parts.find((part) => part.type === 'finish')).toMatchObject({ finishReason: { unified: 'error' } });
    });

    it('merges extracted metadata with prediction token details on finish', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] },
                { choices: [], usage: { completion_tokens_details: { accepted_prediction_tokens: 2 } }, cost: { diem: 0.01, usd: 0.02 } }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(parts.find((part) => part.type === 'finish')?.providerMetadata).toEqual({
            venice: { cost: { diem: 0.01, usd: 0.02 }, acceptedPredictionTokens: 2 },
        });
    });

    it('attaches a late thought signature to the text-end part', async () => {
        const { model } = createModel(() =>
            sseResponse(
                { choices: [{ delta: { content: 'answer' } }] },
                { choices: [{ delta: { thought_signature: 'sig-late' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            )
        );

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        const textEnd = parts.find((part) => part.type === 'text-end');
        expect(textEnd?.providerMetadata).toEqual({ venice: { thoughtSignature: 'sig-late' } });
    });

    it('emits an error part for in-stream error chunks', async () => {
        const { model } = createModel(() => sseResponse({ error: { message: 'overloaded', type: 'server_error', code: 'model_overloaded' } }));

        const parts = await collectStream((await model.doStream({ prompt })).stream);

        expect(parts.some((part) => part.type === 'error')).toBe(true);
    });
});

describe('VeniceChatLanguageModel provider options', () => {
    const jsonSchema = { type: 'object', properties: {}, additionalProperties: false };

    it('enables json_schema responses through the structuredOutputs option', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        await model.doGenerate({
            prompt,
            responseFormat: { type: 'json', schema: jsonSchema },
            providerOptions: { venice: { structuredOutputs: true } },
        });

        expect(requests[0]?.response_format).toMatchObject({ type: 'json_schema' });
    });

    it('maps verbosity and textVerbosity to the verbosity field', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        await model.doGenerate({ prompt, providerOptions: { venice: { verbosity: 'high' } } });
        await model.doGenerate({ prompt, providerOptions: { venice: { textVerbosity: 'low' } } });

        expect(requests[0]?.verbosity).toBe('high');
        expect(requests[1]?.verbosity).toBe('low');
    });

    it('sends reasoning_effort null without an effort inside reasoning', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        await model.doGenerate({ prompt, providerOptions: { venice: { reasoningEffort: null } } });

        expect(requests[0]?.reasoning_effort).toBeNull();
        expect(requests[0]?.reasoning).toBeUndefined();
    });

    it('keeps a raw reasoning_effort passthrough option', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        await model.doGenerate({ prompt, providerOptions: { venice: { reasoning_effort: 'high' } } });

        expect(requests[0]?.reasoning_effort).toBe('high');
    });

    it('parses camelCase provider options and uses them for metadata', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })), { provider: 'my-venice.chat' });

        const result = await model.doGenerate({ prompt, providerOptions: { myVenice: { verbosity: 'low' } } });

        expect(requests[0]?.verbosity).toBe('low');
        expect(result.providerMetadata).toHaveProperty('myVenice');
    });

    it('applies transformRequestBody before sending', async () => {
        const { model, requests } = createModel(() => jsonResponse(generateBody({ content: 'answer' })), {
            transformRequestBody: (args) => ({ ...args, extra_field: 'x' }),
        });

        await model.doGenerate({ prompt });

        expect(requests[0]?.extra_field).toBe('x');
    });

    it('uses a custom convertUsage', async () => {
        const { model } = createModel(() => jsonResponse(generateBody({ content: 'answer' })), {
            convertUsage: (usage) => emptyUsage(usage ?? undefined),
        });

        const result = await model.doGenerate({ prompt });

        expect(result.usage).toHaveProperty('raw');
    });

    it('exposes default supportedUrls', () => {
        const { model } = createModel(() => jsonResponse(generateBody({ content: 'answer' })));

        expect(model.supportedUrls).toHaveProperty('image/*');
    });
});

describe('createVenice chat model parity', () => {
    it('accepts per-model config overrides', async () => {
        const { fetch, requests } = createFetch(() => jsonResponse(generateBody({ content: 'answer' })));
        const provider = createVenice({ apiKey: 'test-key', fetch });

        const model = provider.languageModel('test-model', { transformRequestBody: (args) => ({ ...args, marker: true }) });
        await model.doGenerate({ prompt });

        expect(requests[0]?.marker).toBe(true);
    });

    it('forwards transformRequestBody and convertUsage settings', async () => {
        const { fetch, requests } = createFetch(() => jsonResponse(generateBody({ content: 'answer' })));
        const provider = createVenice({
            apiKey: 'test-key',
            fetch,
            transformRequestBody: (args) => ({ ...args, marker: 'from-settings' }),
            convertUsage: () => emptyUsage({ custom: true }),
        });

        const result = await provider.chatModel('test-model').doGenerate({ prompt });

        expect(requests[0]?.marker).toBe('from-settings');
        expect(result.usage.raw).toEqual({ custom: true });
    });

    it('uses the provider metadataExtractor setting', async () => {
        const { fetch } = createFetch(() => jsonResponse(generateBody({ content: 'answer' })));
        const provider = createVenice({
            apiKey: 'test-key',
            fetch,
            metadataExtractor: {
                extractMetadata: async () => ({ custom: { foo: 'bar' } }),
                createStreamExtractor: () => ({ processChunk: () => {}, buildMetadata: () => ({ custom: { foo: 'bar' } }) }),
            },
        });

        const result = await provider.chatModel('test-model').doGenerate({ prompt });

        expect(result.providerMetadata?.custom).toEqual({ foo: 'bar' });
    });
});

describe('round-trip of generated parts into the next-turn wire message', () => {
    const userMessage: LanguageModelV3Prompt[number] = { role: 'user', content: [{ type: 'text', text: 'hi' }] };

    const toolMessage: LanguageModelV3Prompt[number] = {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'text', value: 'ok' } }],
    };

    // Mirrors what `ai`'s toResponseMessages does: part providerMetadata becomes prompt providerOptions.
    function toAssistantPromptMessage(content: LanguageModelV3Content[]): LanguageModelV3Prompt[number] {
        return {
            role: 'assistant',
            content: content.map((part) => (part.providerMetadata == null ? part : { ...part, providerOptions: part.providerMetadata })),
        } as LanguageModelV3Prompt[number];
    }

    function convertSecondTurn(content: LanguageModelV3Content[]) {
        const wire = convertToVeniceChatMessages([userMessage, toAssistantPromptMessage(content), toolMessage], 'test-model');
        return wire[1] as { tool_calls?: Array<{ thought_signature?: string }>; reasoning_details?: Array<{ text?: string }> };
    }

    it('keeps a tool-call thought signature', async () => {
        const { model } = createModel(() =>
            jsonResponse(
                generateBody({
                    content: 'checking',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            extra_content: { google: { thought_signature: 'sig-flash' } },
                            function: { name: 'lookup', arguments: '{"q":"x"}' },
                        },
                    ],
                })
            )
        );

        const result = await model.doGenerate({ prompt });

        expect(convertSecondTurn(result.content).tool_calls?.[0]?.thought_signature).toBe('sig-flash');
    });

    it('keeps reasoning details emitted alongside tool calls only', async () => {
        const reasoningDetails = [{ type: 'reasoning.text', text: 'thinking' }];
        const { model } = createModel(() =>
            jsonResponse(
                generateBody({
                    reasoning_details: reasoningDetails,
                    tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
                })
            )
        );

        const result = await model.doGenerate({ prompt });

        expect(convertSecondTurn(result.content).reasoning_details).toEqual(reasoningDetails);
    });
});
