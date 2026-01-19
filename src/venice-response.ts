import { z } from 'zod/v4';

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
export type VeniceTokenUsage = z.infer<typeof veniceTokenUsageSchema>;

export const VeniceChatResponseSchema = z.looseObject({
    id: z.string().nullish(),
    object: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    service_tier: z.string().nullish(),
    system_fingerprint: z.string().nullish(),
    choices: z.array(
        z.object({
            index: z.number().nullish(),
            message: z.object({
                role: z.literal('assistant').nullish(),
                content: z.string().nullish(),
                refusal: z.string().nullish(),
                annotations: z.array(z.any()).nullish(),
                audio: z.any().nullish(),
                function_call: z.any().nullish(),
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
                reasoning_content: z.string().nullish(),
                reasoning: z.string().nullish(),
            }),
            logprobs: z.any().nullish(),
            finish_reason: z.string().nullish(),
            stop_reason: z.number().nullish(),
            token_ids: z.array(z.number()).nullish(),
        })
    ),
    usage: veniceTokenUsageSchema,
    prompt_logprobs: z.any().nullish(),
    prompt_token_ids: z.array(z.number()).nullish(),
    kv_transfer_params: z.any().nullish(),
    venice_parameters: z
        .object({
            strip_thinking_response: z.boolean().nullish(),
            disable_thinking: z.boolean().nullish(),
            enable_web_search: z.string().nullish(),
            enable_web_scraping: z.boolean().nullish(),
            enable_web_citations: z.boolean().nullish(),
            include_search_results_in_stream: z.boolean().nullish(),
            include_venice_system_prompt: z.boolean().nullish(),
            web_search_citations: z.array(z.any()).nullish(),
            return_search_results_as_documents: z.boolean().nullish(),
        })
        .nullish(),
});
export type VeniceChatResponse = z.infer<typeof VeniceChatResponseSchema>;

export const veniceChunkSchema = z.looseObject({
    id: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    choices: z.array(
        z.object({
            delta: z
                .object({
                    role: z.enum(['assistant']).nullish(),
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
export const createVeniceChatChunkSchema = <ERROR_SCHEMA extends z.ZodType>(errorSchema: ERROR_SCHEMA) => z.union([veniceChunkSchema, errorSchema]);
