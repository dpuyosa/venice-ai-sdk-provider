import type { VeniceChatResponse } from './venice-response';
import type { LanguageModelV2Usage } from '@ai-sdk/provider';

export function convertVeniceChatUsage(usage: VeniceChatResponse['usage']): LanguageModelV2Usage {
    if (usage == null) {
        return {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
        };
    }

    return {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? undefined,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
    };
}
