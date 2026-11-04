import { describe, expect, it } from 'vitest';
import { convertVeniceChatUsage } from '../src/venice-chat-usage';
import { createVeniceMetadataExtractor } from '../src/venice-metadata-extractor';

describe('convertVeniceChatUsage', () => {
    it.each([undefined, null])('returns empty usage when usage is %s', (usage) => {
        expect(convertVeniceChatUsage(usage)).toEqual({
            inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
            raw: undefined,
        });
    });

    it('maps prompt and completion tokens', () => {
        const result = convertVeniceChatUsage({
            prompt_tokens: 100,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 30 },
            completion_tokens_details: { reasoning_tokens: 10 },
        });

        expect(result.inputTokens).toEqual({ total: 100, noCache: 70, cacheRead: 30, cacheWrite: undefined });
        expect(result.outputTokens).toEqual({ total: 40, text: 30, reasoning: 10 });
    });

    it('maps cache_creation_input_tokens to cacheWrite', () => {
        const result = convertVeniceChatUsage({
            prompt_tokens: 100,
            prompt_tokens_details: { cached_tokens: 30, cache_creation_input_tokens: 12 },
        });

        expect(result.inputTokens.cacheWrite).toBe(12);
    });

    it('clamps outputTokens.text at 0 when reasoning exceeds completion tokens', () => {
        const result = convertVeniceChatUsage({
            completion_tokens: 5,
            completion_tokens_details: { reasoning_tokens: 20 },
        });

        expect(result.outputTokens.text).toBe(0);
        expect(result.outputTokens.reasoning).toBe(20);
    });

    it('clamps inputTokens.noCache at 0 when cached tokens exceed prompt tokens', () => {
        const result = convertVeniceChatUsage({
            prompt_tokens: 10,
            prompt_tokens_details: { cached_tokens: 25 },
        });

        expect(result.inputTokens.noCache).toBe(0);
        expect(result.inputTokens.cacheRead).toBe(25);
    });

    it('preserves raw usage verbatim including extra fields', () => {
        const usage = {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 2, cache_creation_input_tokens: 1, extra_detail: 'kept' },
            completion_tokens_details: { reasoning_tokens: 1, accepted_prediction_tokens: 3 },
            extra_top_level: 'kept',
        };

        const result = convertVeniceChatUsage(usage);

        expect(result.raw).toBe(usage);
    });
});

describe('createVeniceMetadataExtractor', () => {
    const extractor = createVeniceMetadataExtractor('venice');

    it('extracts non-streaming metadata under the provider name', async () => {
        const metadata = await extractor.extractMetadata({
            parsedBody: {
                cost: { diem: 0.01, usd: 0.02 },
                choices: [
                    {
                        message: {
                            reasoning_details: [{ type: 'reasoning.text', text: 'thinking' }],
                            reasoning_encrypted: true,
                        },
                    },
                ],
                venice_parameters: {
                    web_search_citations: [{ title: 'T', url: 'https://example.com' }],
                },
            },
        });

        expect(metadata).toEqual({
            venice: {
                cost: { diem: 0.01, usd: 0.02 },
                reasoningDetails: [{ type: 'reasoning.text', text: 'thinking' }],
                reasoningEncrypted: true,
                webSearchCitations: [{ title: 'T', url: 'https://example.com' }],
            },
        });
    });

    it('returns undefined when no non-streaming metadata is present', async () => {
        expect(await extractor.extractMetadata({ parsedBody: {} })).toBeUndefined();
    });

    it('collects cost and web search citations from stream chunks', () => {
        const streamExtractor = extractor.createStreamExtractor();

        streamExtractor.processChunk({ choices: [{ delta: { content: 'hi' } }] });
        streamExtractor.processChunk({ choices: [], cost: { diem: 0.01, usd: 0.02 } });
        streamExtractor.processChunk({
            choices: [],
            venice_parameters: { web_search_citations: [{ title: 'T', url: 'https://example.com' }] },
        });

        expect(streamExtractor.buildMetadata()).toEqual({
            venice: {
                cost: { diem: 0.01, usd: 0.02 },
                webSearchCitations: [{ title: 'T', url: 'https://example.com' }],
            },
        });
    });

    it('returns undefined when a stream has no metadata', () => {
        const streamExtractor = extractor.createStreamExtractor();

        streamExtractor.processChunk({ choices: [{ delta: { content: 'hi' } }] });
        streamExtractor.processChunk({ choices: [], venice_parameters: { web_search_citations: [] } });

        expect(streamExtractor.buildMetadata()).toBeUndefined();
    });

    it('ignores malformed stream chunks', () => {
        const streamExtractor = extractor.createStreamExtractor();

        streamExtractor.processChunk(null);
        streamExtractor.processChunk(undefined);
        streamExtractor.processChunk('chunk');
        streamExtractor.processChunk(42);

        expect(streamExtractor.buildMetadata()).toBeUndefined();
    });
});
