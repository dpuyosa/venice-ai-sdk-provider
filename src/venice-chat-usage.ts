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

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;

    return {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        totalTokens: usage.total_tokens ?? undefined,
    };
}
