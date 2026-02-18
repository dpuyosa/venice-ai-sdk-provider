import type { VeniceChatResponse } from './venice-response';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';

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

    return {
        inputTokens: {
            total: usage.total_tokens ?? undefined,
            noCache: usage.prompt_tokens ?? undefined,
            cacheRead: usage.prompt_tokens_details?.cached_tokens ?? undefined,
            cacheWrite: usage.prompt_tokens_details?.cache_creation_input_tokens ?? undefined,
        },
        outputTokens: {
            total: usage.completion_tokens ?? undefined,
            text: undefined,
            reasoning: undefined,
        },
        raw: usage,
    };
}
