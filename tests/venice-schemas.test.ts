import { describe, expect, it } from 'vitest';
import { veniceLanguageModelOptionsSchema, veniceParametersSchema, verbosityValues } from '../src/venice-chat-options';
import { prepareVeniceParameters } from '../src/venice-prepare-parameters';
import { VeniceChatResponseSchema, veniceChunkSchema, veniceContentSchema } from '../src/venice-response';

describe('VeniceChatResponseSchema', () => {
    it('preserves thought_signature on the message', () => {
        const parsed = VeniceChatResponseSchema.parse({
            choices: [{ message: { role: 'assistant', content: 'hi', thought_signature: 'sig-msg' } }],
        });

        expect(parsed.choices?.[0]?.message.thought_signature).toBe('sig-msg');
    });

    it('preserves thought_signature and extra_content on message tool calls', () => {
        const parsed = VeniceChatResponseSchema.parse({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        tool_calls: [
                            {
                                id: 'call-1',
                                type: 'function',
                                index: 0,
                                thought_signature: 'sig-tool',
                                extra_content: { google: { thought_signature: 'sig-google' } },
                                function: { name: 'lookup', arguments: '{}' },
                            },
                        ],
                    },
                },
            ],
        });

        const toolCall = parsed.choices?.[0]?.message.tool_calls?.[0];
        expect(toolCall?.type).toBe('function');
        expect(toolCall?.index).toBe(0);
        expect(toolCall?.thought_signature).toBe('sig-tool');
        expect(toolCall?.extra_content?.google?.thought_signature).toBe('sig-google');
    });

    it('preserves unmodeled keys inside reasoning_details items', () => {
        const parsed = VeniceChatResponseSchema.parse({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: 'hi',
                        reasoning_details: [{ type: 'reasoning.text', text: 'thinking', thought_signature: 'sig-detail' }],
                    },
                },
            ],
        });

        expect(parsed.choices?.[0]?.message.reasoning_details?.[0]?.thought_signature).toBe('sig-detail');
    });

    it('preserves documented and unmodeled venice_parameters keys', () => {
        const parsed = VeniceChatResponseSchema.parse({
            choices: [],
            venice_parameters: { enable_x_search: true, character_slug: 'alice', provider_extra: 'kept' },
        });

        expect(parsed.venice_parameters?.enable_x_search).toBe(true);
        expect(parsed.venice_parameters?.character_slug).toBe('alice');
        expect(parsed.venice_parameters?.provider_extra).toBe('kept');
    });
});

describe('veniceChunkSchema', () => {
    it('preserves thought_signature on the delta', () => {
        const parsed = veniceChunkSchema.parse({ choices: [{ delta: { thought_signature: 'sig-delta' } }] });

        expect(parsed.choices[0]?.delta?.thought_signature).toBe('sig-delta');
    });

    it('preserves thought_signature and extra_content on delta tool calls', () => {
        const parsed = veniceChunkSchema.parse({
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: 'call-1',
                                type: 'function',
                                thought_signature: 'sig-tool',
                                extra_content: { google: { thought_signature: 'sig-google' } },
                                function: { name: 'lookup', arguments: '{}' },
                            },
                        ],
                    },
                },
            ],
        });

        const toolCall = parsed.choices[0]?.delta?.tool_calls?.[0];
        expect(toolCall?.type).toBe('function');
        expect(toolCall?.thought_signature).toBe('sig-tool');
        expect(toolCall?.extra_content?.google?.thought_signature).toBe('sig-google');
    });

    it('preserves unmodeled keys inside delta reasoning_details items', () => {
        const parsed = veniceChunkSchema.parse({
            choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', thought_signature: 'sig-detail' }] } }],
        });

        expect(parsed.choices[0]?.delta?.reasoning_details?.[0]?.thought_signature).toBe('sig-detail');
    });

    it('accepts an empty-string role', () => {
        const parsed = veniceChunkSchema.parse({ choices: [{ delta: { role: '' } }] });

        expect(parsed.choices[0]?.delta?.role).toBe('');
    });

    it('parses cost and venice_parameters on final chunks', () => {
        const parsed = veniceChunkSchema.parse({
            choices: [],
            cost: { diem: 0.001, usd: 0.0001 },
            venice_parameters: {
                web_search_citations: [{ title: 'Example', url: 'https://example.com' }],
            },
        });

        expect(parsed.cost?.diem).toBe(0.001);
        expect(parsed.venice_parameters?.web_search_citations?.[0]?.title).toBe('Example');
    });

    it('preserves documented and unmodeled venice_parameters keys', () => {
        const parsed = veniceChunkSchema.parse({
            choices: [],
            venice_parameters: { enable_x_search: true, character_slug: 'alice', provider_extra: 'kept' },
        });

        expect(parsed.venice_parameters?.enable_x_search).toBe(true);
        expect(parsed.venice_parameters?.character_slug).toBe('alice');
        expect(parsed.venice_parameters?.provider_extra).toBe('kept');
    });
});

describe('veniceContentSchema', () => {
    it('accepts a string', () => {
        expect(veniceContentSchema.parse('hello')).toBe('hello');
    });

    it('accepts an array of content parts', () => {
        const parsed = veniceContentSchema.parse([{ type: 'text', text: 'hello' }]);

        expect(Array.isArray(parsed) && parsed[0]?.type).toBe('text');
    });

    it('accepts null and undefined', () => {
        expect(veniceContentSchema.parse(null)).toBeNull();
        expect(veniceContentSchema.parse(undefined)).toBeUndefined();
    });
});

describe('veniceTokenUsageSchema (via response)', () => {
    it('survives provider-specific usage fields', () => {
        const parsed = VeniceChatResponseSchema.parse({
            choices: [],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                provider_raw_field: 'kept',
                prompt_tokens_details: { cached_tokens: 2, provider_cached_field: 'kept' },
                completion_tokens_details: { reasoning_tokens: 1, provider_reasoning_field: 'kept' },
            },
        });

        expect(parsed.usage?.provider_raw_field).toBe('kept');
        expect(parsed.usage?.prompt_tokens_details?.provider_cached_field).toBe('kept');
        expect(parsed.usage?.completion_tokens_details?.provider_reasoning_field).toBe('kept');
    });
});

describe('veniceParametersSchema', () => {
    it('preserves unknown keys', () => {
        const parsed = veniceParametersSchema.parse({ enableWebSearch: 'on', providerExtra: true, snake_key: 'value' });

        expect(parsed.enableWebSearch).toBe('on');
        expect(parsed.providerExtra).toBe(true);
        expect(parsed.snake_key).toBe('value');
    });

    it('defaults includeVeniceSystemPrompt to false', () => {
        expect(veniceParametersSchema.parse({}).includeVeniceSystemPrompt).toBe(false);
    });
});

describe('prepareVeniceParameters', () => {
    it('converts known and unknown camelCase keys to snake_case', () => {
        const prepared = prepareVeniceParameters({
            veniceParameters: { enableWebSearch: 'on', providerExtra: true, snake_key: 'value' },
        });

        expect(prepared).toEqual({
            enable_web_search: 'on',
            provider_extra: true,
            snake_key: 'value',
            include_venice_system_prompt: false,
        });
    });

    it('keeps include_venice_system_prompt false when veniceParameters is omitted or empty', () => {
        expect(prepareVeniceParameters({ veniceParameters: undefined })).toEqual({ include_venice_system_prompt: false });
        expect(prepareVeniceParameters({ veniceParameters: {} })).toEqual({ include_venice_system_prompt: false });
    });
});

describe('veniceLanguageModelOptionsSchema', () => {
    it('accepts null reasoningEffort', () => {
        const parsed = veniceLanguageModelOptionsSchema.safeParse({ reasoningEffort: null });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.reasoningEffort).toBeNull();
    });

    it('accepts verbosity and textVerbosity', () => {
        const parsed = veniceLanguageModelOptionsSchema.safeParse({ verbosity: 'high', textVerbosity: 'auto' });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.verbosity).toBe('high');
        expect(parsed.data?.textVerbosity).toBe('auto');
    });

    it('rejects unknown verbosity values', () => {
        expect(veniceLanguageModelOptionsSchema.safeParse({ verbosity: 'extreme' }).success).toBe(false);
    });

    it('exposes verbosity values', () => {
        expect(verbosityValues).toEqual(['low', 'medium', 'high', 'auto']);
    });

    it('accepts typed request options', () => {
        const parsed = veniceLanguageModelOptionsSchema.safeParse({
            anonUserId: 'user-123',
            fallbacks: [{ model: 'venice-uncensored' }],
            metadata: { key: 'value' },
            include: ['venice_parameters'],
            store: true,
        });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.anonUserId).toBe('user-123');
        expect(parsed.data?.fallbacks).toEqual([{ model: 'venice-uncensored' }]);
        expect(parsed.data?.metadata).toEqual({ key: 'value' });
        expect(parsed.data?.include).toEqual(['venice_parameters']);
        expect(parsed.data?.store).toBe(true);
    });

    it('rejects invalid anonUserId values', () => {
        const invalid = ['', 'a'.repeat(129), 'user\u0001', 'user||other'];

        for (const anonUserId of invalid) {
            expect(veniceLanguageModelOptionsSchema.safeParse({ anonUserId }).success).toBe(false);
        }
    });

    it('accepts anonUserId at the length limit', () => {
        expect(veniceLanguageModelOptionsSchema.safeParse({ anonUserId: 'a'.repeat(128) }).success).toBe(true);
    });

    it('rejects more than 10 fallbacks', () => {
        const fallbacks = Array.from({ length: 11 }, (_, index) => ({ model: `model-${index}` }));

        expect(veniceLanguageModelOptionsSchema.safeParse({ fallbacks }).success).toBe(false);
    });
});
