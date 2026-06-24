import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import type { VeniceChatResponse } from './venice-response';

export interface VeniceUsage extends LanguageModelV3Usage {}

export function convertVeniceChatUsage(usage: VeniceChatResponse['usage']): VeniceUsage {
    if (usage == null) {
        return {
            inputTokens: {
                total: undefined,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
            },
            outputTokens: {
                total: undefined,
                text: undefined,
                reasoning: undefined,
            },
            raw: undefined,
        };
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;

    return {
        inputTokens: {
            total: promptTokens,
            noCache: promptTokens - cacheReadTokens,
            cacheRead: cacheReadTokens,
            cacheWrite: usage.prompt_tokens_details?.cache_creation_input_tokens ?? undefined,
        },
        outputTokens: {
            total: completionTokens,
            text: completionTokens - reasoningTokens,
            reasoning: reasoningTokens,
        },
        raw: usage,
    };
}
