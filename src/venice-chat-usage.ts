import type { VeniceChatResponse } from './venice-response';
import type { LanguageModelV2Usage } from '@ai-sdk/provider';

export interface VeniceUsage extends LanguageModelV2Usage {
    cacheCreationInputTokens?: number | undefined;
}

export function convertVeniceChatUsage(usage: VeniceChatResponse['usage']): VeniceUsage {
    if (usage == null) {
        return {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
        };
    }

    return {
        inputTokens: usage.prompt_tokens ?? undefined,
        outputTokens: usage.completion_tokens ?? undefined,
        totalTokens: usage.total_tokens ?? undefined,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
        cacheCreationInputTokens: usage.prompt_tokens_details?.cache_creation_input_tokens ?? undefined,
    };
}
