import { z } from 'zod/v4';

export type VeniceChatModelId = string;

export const veniceLanguageModelOptions = z.object({
    veniceParameters: z
        .object({
            enableWebSearch: z.enum(['off', 'on', 'auto']).default('off'),
            enableWebScraping: z.boolean(),
            enableWebCitations: z.boolean(),
            stripThinkingResponse: z.boolean(),
            disableThinking: z.boolean(),
            includeVeniceSystemPrompt: z.boolean().default(false),
            characterSlug: z.string(),
            includeSearchResultsInStream: z.boolean(),
            returnSearchResultsAsDocuments: z.boolean(),
        })
        .optional(),

    topLogprobs: z.number().int().min(0),

    maxCompletionTokens: z.number().int(),

    maxTokens: z.number().int(),

    minP: z.number().min(0).max(1),

    promptCacheKey: z.string(),

    repetitionPenalty: z.number().min(0),

    reasoning: z
        .object({
            effort: z.enum(['low', 'medium', 'high']),
        })
        .optional(),

    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),

    stopTokenIds: z.array(z.number()),

    stream: z.boolean(),

    streamOptions: z
        .object({
            includeUsage: z.boolean(),
        })
        .optional(),

    user: z.string(),

    structuredOutputs: z.boolean(),

    parallelToolCalls: z.boolean(),

    logprobs: z.boolean(),

    maxTemp: z.number().min(0).max(2),

    minTemp: z.number().min(0).max(2),

    n: z.number().int().min(1).default(1),
});

export type VeniceLanguageModelOptions = z.infer<typeof veniceLanguageModelOptions>;
