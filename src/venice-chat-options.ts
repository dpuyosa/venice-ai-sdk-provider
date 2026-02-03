import { z } from 'zod/v4';

export type VeniceChatModelId = string;

export const veniceParametersSchema = z.object({
    enableWebSearch: z.enum(['off', 'on', 'auto']).optional(),
    enableWebScraping: z.boolean().optional(),
    enableWebCitations: z.boolean().optional(),
    stripThinkingResponse: z.boolean().optional(),
    disableThinking: z.boolean().optional(),
    includeVeniceSystemPrompt: z.boolean().default(false),
    characterSlug: z.string().optional(),
    includeSearchResultsInStream: z.boolean().optional(),
    returnSearchResultsAsDocuments: z.boolean().optional(),
});

export const veniceLanguageModelOptionsSchema = z.object({
    veniceParameters: veniceParametersSchema.default({ includeVeniceSystemPrompt: false }),

    topLogprobs: z.int().positive().optional(),

    maxCompletionTokens: z.int().positive().optional(),

    maxTokens: z.int().positive().optional(),

    minP: z.int().positive().max(1).optional(),

    promptCacheKey: z.string().optional(),

    repetitionPenalty: z.int().positive().optional(),

    reasoning: z
        .object({
            effort: z.enum(['low', 'medium', 'high']),
        })
        .optional(),

    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),

    stopTokenIds: z.array(z.number()).optional(),

    stream: z.boolean().default(false),

    streamOptions: z
        .object({
            includeUsage: z.boolean(),
        })
        .optional(),

    user: z.string().optional(),

    structuredOutputs: z.boolean().optional(),

    parallelToolCalls: z.boolean().optional(),

    logprobs: z.boolean().optional(),

    maxTemp: z.number().min(0).max(2).optional(),

    minTemp: z.number().min(0).max(2).optional(),

    n: z.int().min(1).default(1),
});

export type VeniceLanguageModelOptions = z.infer<typeof veniceLanguageModelOptionsSchema>;
