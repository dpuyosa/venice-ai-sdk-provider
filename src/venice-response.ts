import { z } from "zod/v4";

const veniceTokenUsageSchema = z
    .object({
        prompt_tokens: z.number().nullish(),
        completion_tokens: z.number().nullish(),
        total_tokens: z.number().nullish(),
        prompt_tokens_details: z
            .object({
                cached_tokens: z.number().nullish(),
                cache_creation_input_tokens: z.number().nullish(),
            })
            .nullish(),
    })
    .nullish();

export const VeniceChatResponseSchema = z.looseObject({
    id: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    choices: z.array(
        z.object({
            message: z.object({
                role: z.literal("assistant").nullish(),
                content: z.string().nullish(),
                reasoning_content: z.string().nullish(),
                reasoning: z.string().nullish(),
                tool_calls: z
                    .array(
                        z.object({
                            id: z.string().nullish(),
                            function: z.object({
                                name: z.string(),
                                arguments: z.string(),
                            }),
                            extra_content: z
                                .object({
                                    google: z
                                        .object({
                                            thought_signature: z.string().nullish(),
                                        })
                                        .nullish(),
                                })
                                .nullish(),
                        })
                    )
                    .nullish(),
            }),
            finish_reason: z.string().nullish(),
        })
    ),
    usage: veniceTokenUsageSchema,
});
export type VeniceChatResponse = z.infer<typeof VeniceChatResponseSchema>;

const chunkBaseSchema = z.looseObject({
    id: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    choices: z.array(
        z.object({
            delta: z
                .object({
                    role: z.enum(["assistant"]).nullish(),
                    content: z.string().nullish(),
                    // Most openai-compatible models set `reasoning_content`, but some
                    // providers serving `gpt-oss` set `reasoning`. See #7866
                    reasoning_content: z.string().nullish(),
                    reasoning: z.string().nullish(),
                    tool_calls: z
                        .array(
                            z.object({
                                index: z.number().nullish(), //google does not send index
                                id: z.string().nullish(),
                                function: z.object({
                                    name: z.string().nullish(),
                                    arguments: z.string().nullish(),
                                }),
                                // Support for Google Gemini thought signatures via OpenAI compatibility
                                extra_content: z
                                    .object({
                                        google: z
                                            .object({
                                                thought_signature: z.string().nullish(),
                                            })
                                            .nullish(),
                                    })
                                    .nullish(),
                            })
                        )
                        .nullish(),
                })
                .nullish(),
            finish_reason: z.string().nullish(),
        })
    ),
    usage: veniceTokenUsageSchema,
});
export const createOpenAICompatibleChatChunkSchema = <ERROR_SCHEMA extends z.core.$ZodType>(errorSchema: ERROR_SCHEMA) => z.union([chunkBaseSchema, errorSchema]);
