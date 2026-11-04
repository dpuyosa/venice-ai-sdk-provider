import { z } from 'zod/v4';

export type VeniceChatModelId = string;

export const reasoningEffortValues = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ReasoningEffort = (typeof reasoningEffortValues)[number];

export const reasoningSummaryValues = ['auto', 'concise', 'detailed'] as const;

export type ReasoningSummary = (typeof reasoningSummaryValues)[number];

export const promptCacheRetentionValues = ['default', 'extended', '24h'] as const;

export type PromptCacheRetention = (typeof promptCacheRetentionValues)[number];

export const verbosityValues = ['low', 'medium', 'high', 'auto'] as const;

export type Verbosity = (typeof verbosityValues)[number];

export const veniceParametersSchema = z.looseObject({
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

    reasoningEffort: z.enum(reasoningEffortValues).nullish(),

    verbosity: z.enum(verbosityValues).optional(),

    textVerbosity: z.enum(verbosityValues).optional(),

    stopTokenIds: z.array(z.number()).optional(),

    stream: z.boolean().default(false),

    streamOptions: z
        .object({
            includeUsage: z.boolean(),
        })
        .optional(),

    user: z.string().optional(),

    structuredOutputs: z.boolean().optional(),

    strictJsonSchema: z.boolean().optional(),

    parallelToolCalls: z.boolean().optional(),

    logprobs: z.boolean().optional(),

    maxTemp: z.number().min(0).max(2).optional(),

    minTemp: z.number().min(0).max(2).optional(),

    n: z.int().min(1).optional(),

    anonUserId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\x20-\x7E]+$/)
        .refine((val) => !val.includes('||'), { message: 'anonUserId must not contain ||' })
        .optional(),

    fallbacks: z
        .array(z.object({ model: z.string() }))
        .max(10)
        .optional(),

    metadata: z.record(z.string(), z.string()).optional(),

    include: z.array(z.string()).optional(),

    store: z.boolean().optional(),
});

export type VeniceLanguageModelOptions = z.infer<typeof veniceLanguageModelOptionsSchema>;
