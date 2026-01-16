import type { VeniceChatResponse } from "./venice-response";
import type { LanguageModelV3Usage } from "@ai-sdk/provider";

export function convertVeniceChatUsage(usage: VeniceChatResponse["usage"]): LanguageModelV3Usage {
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
    const cacheWriteTokens = usage.prompt_tokens_details?.cache_creation_input_tokens ?? 0;

    return {
        inputTokens: {
            total: promptTokens,
            noCache: promptTokens - cacheReadTokens - cacheWriteTokens,
            cacheRead: cacheReadTokens,
            cacheWrite: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
        },
        outputTokens: {
            total: completionTokens,
            text: completionTokens,
            reasoning: undefined,
        },
        raw: usage,
    };
}
