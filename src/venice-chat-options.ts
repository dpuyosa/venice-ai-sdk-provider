import { z } from 'zod/v4';

export type VeniceChatModelId = string;

export const reasoningEffortValues = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ReasoningEffort = (typeof reasoningEffortValues)[number];

export const reasoningSummaryValues = ['auto', 'concise', 'detailed'] as const;

export type ReasoningSummary = (typeof reasoningSummaryValues)[number];

export const promptCacheRetentionValues = ['default', 'extended', '24h'] as const;

export type PromptCacheRetention = (typeof promptCacheRetentionValues)[number];

export const veniceParametersSchema = z.object({
    enableWebSearch: z.enum(['off', 'on', 'auto']).optional(),
    enableWebScraping: z.boolean().optional(),
    enableWebCitations: z.boolean().optional(),
    enableE2ee: z.boolean().optional(),
    enableXSearch: z.boolean().optional(),
    stripThinkingResponse: z.boolean().optional(),
    disableThinking: z.boolean().optional(),
    includeVeniceSystemPrompt: z.boolean().default(false),
    characterSlug: z.string().optional(),
    includeSearchResultsInStream: z.boolean().optional(),
    returnSearchResultsAsDocuments: z.boolean().optional(),
});

export const veniceLanguageModelOptionsSchema = z.object({
    veniceParameters: veniceParametersSchema.default({ includeVeniceSystemPrompt: false }),

    topLogprobs: z.int().min(0).optional(),

    maxCompletionTokens: z.int().min(0).optional(),

    maxTokens: z.int().min(0).optional(),

    minP: z.number().min(0).max(1).optional(),

    promptCacheKey: z.string().optional(),

    promptCacheRetention: z.enum(promptCacheRetentionValues).optional(),

    repetitionPenalty: z.number().min(0).optional(),

    reasoning: z
        .object({
            effort: z.enum(reasoningEffortValues).optional(),
            enabled: z.boolean().optional(),
            summary: z.enum(reasoningSummaryValues).optional(),
        })
        .optional(),

    reasoningEffort: z.enum(reasoningEffortValues).optional(),

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
