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
