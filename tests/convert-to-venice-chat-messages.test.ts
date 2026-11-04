import { describe, expect, it } from 'vitest';
import { convertToVeniceChatMessages } from '../src/convert-to-venice-chat-messages';
import { VeniceChatLanguageModel } from '../src/venice-chat-language-model';

describe('convertToVeniceChatMessages', () => {
    it('preserves Claude arrays, empty assistant omission, newline tool-only assistants, and raw Venice metadata', () => {
        const messages = convertToVeniceChatMessages(
            [
                { role: 'assistant', content: [] },
                {
                    role: 'assistant',
                    content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { q: 'x' } }],
                },
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'hello', providerOptions: { venice: { cache_control: { type: 'ephemeral' } } } }],
                },
            ],
            'claude-sonnet-5'
        );

        expect(messages).toEqual([
            {
                role: 'assistant',
                tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
                content: [{ type: 'text', text: '\n' }],
            },
            {
                role: 'user',
                content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
            },
        ]);
    });

    it('normalizes empty tools to no tool messages', () => {
        expect(convertToVeniceChatMessages([{ role: 'tool', content: [] }], 'model')).toEqual([]);
    });

    it('converts non-media files and validates URL protocols', () => {
        expect(
            convertToVeniceChatMessages(
                [{ role: 'user', content: [{ type: 'file', mediaType: 'application/pdf', data: new Uint8Array([1, 2]), filename: 'doc.pdf' }] }],
                'model'
            )[0]
        ).toMatchObject({ content: [{ type: 'file', file: { file_data: 'data:application/pdf;base64,AQI=', filename: 'doc.pdf' } }] });

        expect(() =>
            convertToVeniceChatMessages([{ role: 'user', content: [{ type: 'file', mediaType: 'application/pdf', data: new URL('ftp://example.com/doc.pdf') }] }], 'model')
        ).toThrow(/protocol/);
    });

    it('preserves base64 file data and public file URLs as native Venice files', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'user',
                    content: [
                        { type: 'file', mediaType: 'application/json', data: 'eyJoZWxsbyI6IndvcmxkIn0=', filename: 'context.json' },
                        { type: 'file', mediaType: 'application/pdf', data: new URL('https://example.com/context.pdf?version=1') },
                    ],
                },
            ],
            'model'
        );

        expect(messages[0]).toMatchObject({
            content: [
                { type: 'file', file: { file_data: 'data:application/json;base64,eyJoZWxsbyI6IndvcmxkIn0=', filename: 'context.json' } },
                { type: 'file', file: { file_data: 'https://example.com/context.pdf?version=1' } },
            ],
        });
    });

    it('leaves Qwen think tags as text for Venice to interpret', () => {
        expect(
            convertToVeniceChatMessages(
                [{ role: 'assistant', content: [{ type: 'text', text: '<think>internal reasoning</think>answer' }] }],
                'qwen3-4b'
            )
        ).toEqual([{ role: 'assistant', content: '<think>internal reasoning</think>answer', tool_calls: undefined, reasoning_content: undefined }]);
    });

    it('replays tool-call thought signatures without leaking them into the text content block', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'hi' },
                        { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' }, providerOptions: { venice: { thoughtSignature: 'sig-v' } } },
                        { type: 'tool-call', toolCallId: 'c2', toolName: 'lookup', input: { q: 'y' }, providerOptions: { google: { thoughtSignature: 'sig-g' } } },
                    ],
                },
            ],
            'gemini-3-1-pro-preview'
        );

        expect(messages).toEqual([
            {
                role: 'assistant',
                tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' }, thought_signature: 'sig-v' },
                    { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{"q":"y"}' }, thought_signature: 'sig-g' },
                ],
                reasoning_content: undefined,
                reasoning_details: undefined,
                content: 'hi',
            },
        ]);
    });

    it('collects reasoning details attached to tool calls onto the assistant message', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'ok' },
                        { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' }, providerOptions: { venice: { reasoningDetails: [{ type: 'reasoning.encrypted', data: 'xyz' }] } } },
                    ],
                },
            ],
            'gemini-3-1-pro-preview'
        );

        expect(messages).toEqual([
            {
                role: 'assistant',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
                reasoning_content: undefined,
                reasoning_details: [{ type: 'reasoning.encrypted', data: 'xyz' }],
                content: 'ok',
            },
        ]);
    });

    it('replays reasoning details and signatures and keeps reasoning-only assistant messages', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'reasoning',
                            text: 'thinking',
                            providerOptions: {
                                venice: {
                                    reasoningDetails: [{ type: 'reasoning.text', text: 'thinking', signature: 'abc' }],
                                    thoughtSignature: 'msg-sig',
                                },
                            },
                        },
                    ],
                },
            ],
            'gemini-3-1-pro-preview'
        );

        expect(messages).toEqual([
            {
                role: 'assistant',
                tool_calls: undefined,
                reasoning_content: 'thinking',
                reasoning_details: [{ type: 'reasoning.text', text: 'thinking', signature: 'abc' }],
                thought_signature: 'msg-sig',
                content: '\n',
            },
        ]);
    });

    it('normalizes message-level provider metadata to wire keys', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'hi' }],
                    providerOptions: { venice: { thoughtSignature: 'msig', reasoningDetails: [{ type: 'reasoning.text', text: 't' }] } },
                },
            ],
            'model'
        );

        expect(messages).toEqual([
            {
                role: 'assistant',
                tool_calls: undefined,
                reasoning_content: undefined,
                reasoning_details: [{ type: 'reasoning.text', text: 't' }],
                thought_signature: 'msig',
                content: 'hi',
            },
        ]);
    });

    it('serializes tool call arguments safely', () => {
        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'tool-call', toolCallId: 'raw-json', toolName: 'lookup', input: '{"q":"x"}' },
                        { type: 'tool-call', toolCallId: 'raw-text', toolName: 'lookup', input: 'not-json' },
                        { type: 'tool-call', toolCallId: 'bigint', toolName: 'lookup', input: { n: 10n } },
                    ],
                },
            ],
            'model'
        );

        expect(messages[0]).toMatchObject({
            tool_calls: [
                { id: 'raw-json', function: { arguments: '{"q":"x"}' } },
                { id: 'raw-text', function: { arguments: '"not-json"' } },
                { id: 'bigint', function: { arguments: '{"n":"10"}' } },
            ],
        });
    });

    it('serializes tool results with bigint and cyclic values', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;

        const messages = convertToVeniceChatMessages(
            [
                {
                    role: 'tool',
                    content: [
                        { type: 'tool-result', toolCallId: 'c1', toolName: 'lookup', output: { type: 'json', value: { n: 10n } } },
                        { type: 'tool-result', toolCallId: 'c2', toolName: 'lookup', output: { type: 'json', value: cyclic } },
                    ],
                },
            ],
            'model'
        );

        expect(messages[0]).toMatchObject({ tool_call_id: 'c1', content: '{"n":"10"}' });
        expect(messages[1]).toMatchObject({ tool_call_id: 'c2', content: '{"a":1,"self":"[Circular]"}' });
    });

    it('supports pcm24 audio and rejects unknown audio formats', () => {
        const messages = convertToVeniceChatMessages([{ role: 'user', content: [{ type: 'file', mediaType: 'audio/pcm24', data: new Uint8Array([1, 2]) }] }], 'model');

        expect(messages[0]).toMatchObject({ content: [{ type: 'input_audio', input_audio: { data: 'AQI=', format: 'pcm24' } }] });
        expect(() =>
            convertToVeniceChatMessages([{ role: 'user', content: [{ type: 'file', mediaType: 'audio/webm', data: new Uint8Array([1]) }] }], 'model')
        ).toThrow(/audio media type audio\/webm/);
    });

    it('omits n by default and clamps explicit multiple choices to one', async () => {
        const model = new VeniceChatLanguageModel('model', {
            provider: 'venice.chat',
            headers: () => ({}),
            url: ({ path }) => `https://example.com${path}`,
        });
        const getArgs = (model as unknown as { getArgs: (options: object) => Promise<{ args: { n?: number }; warnings: Array<{ message?: string }> }> }).getArgs.bind(model);
        const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }];

        await expect(getArgs({ prompt, providerOptions: {} })).resolves.toMatchObject({ args: { n: undefined } });
        await expect(getArgs({ prompt, providerOptions: { venice: { n: 3 } } })).resolves.toMatchObject({
            args: { n: 1 },
            warnings: [expect.objectContaining({ message: expect.stringContaining("'n' was reduced from 3 to 1") })],
        });
    });

    it('only passes documented public URL categories through to Venice', async () => {
        const model = new VeniceChatLanguageModel('model', {
            provider: 'venice.chat',
            headers: () => ({}),
            url: ({ path }) => `https://example.com${path}`,
        });

        const supportedUrls = await model.supportedUrls;

        expect(supportedUrls).toMatchObject({
            '*/*': [/^data:/],
            'image/*': [/^https?:\/\//],
            'video/mp4': [/^https?:\/\//],
            'video/mpeg': [/^https?:\/\//],
            'video/mov': [/^https?:\/\//],
            'video/webm': [/^https?:\/\//],
            'application/*': [/^https?:\/\//],
            'text/*': [/^https?:\/\//],
        });
        expect(supportedUrls['audio/*']).toBeUndefined();
        expect(supportedUrls['video/*']).toBeUndefined();
    });
});
