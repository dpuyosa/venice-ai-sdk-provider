import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';
import type {
    APICallError,
    JSONObject,
    LanguageModelV3,
    LanguageModelV3CallOptions,
    LanguageModelV3Content,
    LanguageModelV3FinishReason,
    LanguageModelV3StreamPart,
    SharedV3ProviderMetadata,
    SharedV3Warning,
} from '@ai-sdk/provider';
import { InvalidResponseDataError } from '@ai-sdk/provider';
import type { FetchFunction, ParseResult, ResponseHandler } from '@ai-sdk/provider-utils';
import { combineHeaders, createEventSourceResponseHandler, createJsonErrorResponseHandler, createJsonResponseHandler, generateId, parseProviderOptions, postJsonToApi } from '@ai-sdk/provider-utils';
import type { z } from 'zod/v4';
import { convertToVeniceChatMessages } from './convert-to-venice-chat-messages';
import { getResponseMetadata } from './get-response-metadata';
import { mapFinishReason } from './map-finish-reason';
import type { VeniceLanguageModelOptions } from './venice-chat-options';
import { veniceLanguageModelOptionsSchema } from './venice-chat-options';
import { convertVeniceChatUsage } from './venice-chat-usage';
import { defaultVeniceErrorStructure } from './venice-error';
import type { MetadataExtractor } from './venice-metadata-extractor';
import { prepareVeniceParameters } from './venice-prepare-parameters';
import { prepareTools } from './venice-prepare-tools';
import type { VeniceChatResponse, VeniceTokenUsage, veniceChunkSchema } from './venice-response';
import { createVeniceChatChunkSchema, VeniceChatResponseSchema } from './venice-response';

export interface VeniceChatConfig {
    provider: string;
    headers: () => Record<string, string | undefined>;
    url: (options: { modelId: string; path: string }) => string;
    fetch?: FetchFunction;
    includeUsage?: boolean;
    // biome-ignore lint/suspicious/noExplicitAny: error structures are generic over caller-provided schemas.
    errorStructure?: ProviderErrorStructure<any>;
    supportsStructuredOutputs?: boolean;
    supportedUrls?: () => LanguageModelV3['supportedUrls'];
    metadataExtractor?: MetadataExtractor;
}

function buildReasoningArg(options: VeniceLanguageModelOptions): Record<string, unknown> | undefined {
    const effort = options.reasoningEffort ?? options.reasoning?.effort;
    const enabled = options.reasoning?.enabled;
    const summary = options.reasoning?.summary;

    if (effort == null && enabled == null && summary == null) return undefined;

    const reasoning: Record<string, unknown> = {};
    if (effort != null) reasoning.effort = effort;
    if (enabled != null) reasoning.enabled = enabled;
    if (summary != null) reasoning.summary = summary;
    return reasoning;
}

export class VeniceChatLanguageModel implements LanguageModelV3 {
    readonly specificationVersion = 'v3';
    readonly modelId: string;
    readonly config: VeniceChatConfig;
    private readonly failedResponseHandler: ResponseHandler<APICallError>;
    private readonly successfulResponseHandler: ResponseHandler<VeniceChatResponse>;
    private readonly successfulEventResponseHandler: ResponseHandler<ReadableStream>;
    private readonly chunkSchema;

    constructor(modelId: string, config: VeniceChatConfig) {
        this.modelId = modelId;
        this.config = config;

        const errorStructure = config.errorStructure ?? defaultVeniceErrorStructure;

        this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure);
        this.successfulResponseHandler = createJsonResponseHandler(VeniceChatResponseSchema);

        this.chunkSchema = createVeniceChatChunkSchema(errorStructure.errorSchema);
        this.successfulEventResponseHandler = createEventSourceResponseHandler(createVeniceChatChunkSchema(this.chunkSchema));
    }

    get provider(): string {
        return this.config.provider ?? 'venice';
    }

    private get providerOptionsName(): string {
        return this.config.provider?.split('.')[0]?.trim() ?? 'venice';
    }

    get supportedUrls() {
        return (
            this.config.supportedUrls?.() ?? {
                '*/*': [/^data:/],
                'image/*': [/^https?:\/\//],
                'video/mp4': [/^https?:\/\//],
                'video/mpeg': [/^https?:\/\//],
                'video/mov': [/^https?:\/\//],
                'video/webm': [/^https?:\/\//],
                'application/*': [/^https?:\/\//],
                'text/*': [/^https?:\/\//],
            }
        );
    }

    private async getArgs(options: LanguageModelV3CallOptions) {
        const warnings: SharedV3Warning[] = [];

        // Parse deprecated key first (lowest precedence).
        const deprecatedOptions = await parseProviderOptions({
            provider: 'openai-compatible',
            providerOptions: options.providerOptions,
            schema: veniceLanguageModelOptionsSchema,
        });

        if (deprecatedOptions != null) {
            warnings.push({
                type: 'other' as const,
                message: `The 'openai-compatible' key in providerOptions is deprecated. Use 'venice' instead.`,
            });
        }

        // Merge: deprecated < openaiCompatible < raw provider name
        const compatibleOptions = Object.assign(
            deprecatedOptions ?? {},
            (await parseProviderOptions({ provider: 'openaiCompatible', providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {},
            (await parseProviderOptions({ provider: this.providerOptionsName, providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {}
        ) as VeniceLanguageModelOptions;

        if (compatibleOptions.n != null && compatibleOptions.n > 1) {
            warnings.push({
                type: 'other',
                message: `The Venice API supports multiple choices, but this LanguageModelV3 adapter exposes one completion; provider option 'n' was reduced from ${compatibleOptions.n} to 1.`,
            });
        }

        if (options.responseFormat?.type === 'json' && options.responseFormat.schema != null && !this.config.supportsStructuredOutputs) {
            warnings.push({
                type: 'unsupported' as const,
                feature: 'responseFormat',
                details: 'JSON response format schema is only supported with structuredOutputs',
            });
        }

        const {
            tools: veniceTools,
            toolChoice: veniceToolChoice,
            toolWarnings,
        } = prepareTools({
            tools: options.tools,
            toolChoice: options.toolChoice,
        });

        const knownOptionKeys = Object.keys(veniceLanguageModelOptionsSchema.shape);
        const rawProviderOptions = Object.entries({ ...options.providerOptions?.[this.providerOptionsName] });
        const passthroughOptions = Object.fromEntries(rawProviderOptions.filter(([key]) => !knownOptionKeys.includes(key)));

        const args = {
            model: this.modelId,

            n: compatibleOptions.n == null ? undefined : 1,
            user: compatibleOptions.user,
            max_completion_tokens: compatibleOptions.maxCompletionTokens ?? compatibleOptions.maxTokens ?? options.maxOutputTokens,
            stream: compatibleOptions.stream,
            stream_options: compatibleOptions.streamOptions == null ? undefined : { include_usage: compatibleOptions.streamOptions.includeUsage },

            stop: options.stopSequences,
            stop_token_ids: compatibleOptions.stopTokenIds,
            seed: options.seed,

            temperature: options.temperature,
            max_temp: compatibleOptions.maxTemp,
            min_temp: compatibleOptions.minTemp,
            top_p: options.topP,
            min_p: compatibleOptions.minP,
            top_k: options.topK,

            frequency_penalty: options.frequencyPenalty,
            presence_penalty: options.presencePenalty,
            repetition_penalty: compatibleOptions.repetitionPenalty,

            logprobs: compatibleOptions.logprobs,
            top_logprobs: compatibleOptions.topLogprobs,

            reasoning: buildReasoningArg(compatibleOptions),
            reasoning_effort: undefined,
            prompt_cache_key: compatibleOptions.promptCacheKey,
            prompt_cache_retention: compatibleOptions.promptCacheRetention,

            parallel_tool_calls: compatibleOptions.parallelToolCalls,

            venice_parameters: prepareVeniceParameters({ veniceParameters: compatibleOptions.veniceParameters }),
            response_format:
                options.responseFormat?.type === 'json'
                    ? options.responseFormat.schema != null && this.config.supportsStructuredOutputs === true
                        ? {
                              type: 'json_schema',
                              json_schema: {
                                  schema: options.responseFormat.schema,
                                  strict: compatibleOptions.strictJsonSchema ?? true,
                                  name: options.responseFormat.name ?? 'response',
                                  description: options.responseFormat.description,
                              },
                          }
                        : { type: 'json_object' }
                    : undefined,

            tool_choice: veniceToolChoice,
            tools: veniceTools,

            messages: convertToVeniceChatMessages(options.prompt, this.modelId),

            ...passthroughOptions,
        };

        return {
            args,
            warnings: [...warnings, ...toolWarnings],
        };
    }

    async doGenerate(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
        const { args, warnings } = await this.getArgs(options);
        const body = { ...args, stream: false };

        const {
            responseHeaders,
            value: responseBody,
            rawValue: rawResponse,
        } = await postJsonToApi({
            url: this.config.url({ path: '/chat/completions', modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const choice = responseBody.choices[0];
        const content: Array<LanguageModelV3Content> = [];
        const providerOptionsName = this.providerOptionsName;

        const text = choice?.message.content ?? null;
        const reasoning = choice?.message.reasoning_content ?? choice?.message.reasoning ?? null;

        if (text !== null && text.length > 0) content.push({ type: 'text', text });
        if (reasoning != null && reasoning.length > 0) content.push({ type: 'reasoning', text: reasoning });

        if (choice?.message?.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                content.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments,
                });
            }
        }

        const veniceUsage = convertVeniceChatUsage(responseBody.usage);
        const providerMetadata: SharedV3ProviderMetadata = {
            [providerOptionsName]: {},
            ...(await this.config.metadataExtractor?.extractMetadata?.({ parsedBody: rawResponse })),
        } as SharedV3ProviderMetadata;

        const metadata = providerMetadata[providerOptionsName] ?? {};
        providerMetadata[providerOptionsName] = metadata;

        const completionTokenDetails = responseBody.usage?.completion_tokens_details;
        if (completionTokenDetails?.accepted_prediction_tokens != null) {
            metadata.acceptedPredictionTokens = completionTokenDetails.accepted_prediction_tokens;
        }
        if (completionTokenDetails?.rejected_prediction_tokens != null) {
            metadata.rejectedPredictionTokens = completionTokenDetails.rejected_prediction_tokens;
        }

        return {
            content,
            finishReason: {
                unified: mapFinishReason(choice?.finish_reason) ?? 'other',
                raw: choice?.finish_reason ?? undefined,
            },
            usage: veniceUsage,
            providerMetadata,
            request: { body },
            response: {
                ...getResponseMetadata(responseBody),
                headers: responseHeaders,
                body: rawResponse,
            },
            warnings,
        };
    }

    async doStream(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
        const { args, warnings } = await this.getArgs(options);
        const body = {
            ...args,
            stream: true,
            stream_options: args.stream_options ?? (this.config.includeUsage ? { include_usage: true } : undefined),
        };

        const { responseHeaders, value: response } = await postJsonToApi({
            url: this.config.url({ path: '/chat/completions', modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulEventResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const toolCalls: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
            hasFinished: boolean;
            hasStarted: boolean;
        }> = [];

        let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined };

        const metadataExtractor = this.config.metadataExtractor?.createStreamExtractor();
        const providerOptionsName = this.providerOptionsName;
        let usage: VeniceTokenUsage;
        let isFirstChunk = true;
        let isActiveText = false;
        let isActiveReasoning = false;
        let reasoningDetails: NonNullable<NonNullable<VeniceChatResponse['choices']>[number]['message']['reasoning_details']> = [];
        let reasoningEncrypted: boolean | undefined;

        return {
            stream: response.pipeThrough(
                new TransformStream<ParseResult<z.infer<typeof this.chunkSchema>>, LanguageModelV3StreamPart>({
                    start(controller) {
                        controller.enqueue({ type: 'stream-start', warnings });
                    },

                    transform(chunk, controller) {
                        if (options.includeRawChunks) {
                            controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
                        }

                        if (!chunk.success) {
                            finishReason = { unified: 'error', raw: undefined };
                            controller.enqueue({ type: 'error', error: chunk.error });
                            return;
                        }

                        metadataExtractor?.processChunk(chunk.rawValue);

                        if ('error' in chunk.value) {
                            finishReason = { unified: 'error', raw: undefined };
                            controller.enqueue({ type: 'error', error: chunk.value.error.message });
                            return;
                        }

                        // TODO we lost type safety on Chunk, most likely due to the error schema. MUST FIX
                        // remove this workaround when the issue is fixed
                        const value = chunk.value as z.infer<typeof veniceChunkSchema>;

                        if (isFirstChunk) {
                            isFirstChunk = false;

                            controller.enqueue({
                                type: 'response-metadata',
                                ...getResponseMetadata(value),
                            });
                        }

                        if (value.usage != null) {
                            usage = value.usage;
                        }

                        const choice = value.choices[0];

                        if (choice?.finish_reason != null) {
                            finishReason = {
                                unified: mapFinishReason(choice.finish_reason) ?? 'other',
                                raw: choice.finish_reason,
                            };
                        }

                        if (choice?.delta == null) {
                            return;
                        }

                        const delta = choice.delta;

                        if (delta.reasoning_details != null) {
                            reasoningDetails = [...reasoningDetails, ...delta.reasoning_details];
                        }

                        if (delta.reasoning_encrypted != null) {
                            reasoningEncrypted = delta.reasoning_encrypted;
                        }

                        const reasoningContent = delta.reasoning_content ?? delta.reasoning;
                        if (reasoningContent) {
                            if (!isActiveReasoning) {
                                controller.enqueue({
                                    type: 'reasoning-start',
                                    id: 'reasoning-0',
                                });
                                isActiveReasoning = true;
                            }

                            controller.enqueue({
                                type: 'reasoning-delta',
                                id: 'reasoning-0',
                                delta: reasoningContent,
                            });
                        }

                        if (delta.content) {
                            // end active reasoning block before text starts
                            if (isActiveReasoning) {
                                controller.enqueue({
                                    type: 'reasoning-end',
                                    id: 'reasoning-0',
                                });
                                isActiveReasoning = false;
                            }

                            if (!isActiveText) {
                                controller.enqueue({ type: 'text-start', id: 'txt-0' });
                                isActiveText = true;
                            }

                            controller.enqueue({
                                type: 'text-delta',
                                id: 'txt-0',
                                delta: delta.content,
                            });
                        }

                        if (delta.tool_calls != null) {
                            // end active reasoning block before tool calls start
                            if (isActiveReasoning) {
                                controller.enqueue({
                                    type: 'reasoning-end',
                                    id: 'reasoning-0',
                                });
                                isActiveReasoning = false;
                            }

                            for (const toolCallDelta of delta.tool_calls) {
                                const index = toolCallDelta.index ?? toolCalls.length;

                                if (toolCalls[index] == null) {
                                    if (toolCallDelta.id == null) {
                                        throw new InvalidResponseDataError({
                                            data: toolCallDelta,
                                            message: `Expected 'id' to be a string.`,
                                        });
                                    }

                                    toolCalls[index] = {
                                        id: toolCallDelta.id,
                                        type: 'function',
                                        function: {
                                            name: toolCallDelta.function?.name ?? '',
                                            arguments: toolCallDelta.function.arguments ?? '',
                                        },
                                        hasFinished: false,
                                        hasStarted: false,
                                    };

                                    const toolCall = toolCalls[index];

                                    if (toolCall.function.name.length > 0) {
                                        controller.enqueue({ type: 'tool-input-start', id: toolCall.id, toolName: toolCall.function.name });
                                        toolCall.hasStarted = true;

                                        if (toolCall.function.arguments.length > 0) {
                                            controller.enqueue({
                                                type: 'tool-input-delta',
                                                id: toolCall.id,
                                                delta: toolCall.function.arguments,
                                            });
                                        }
                                    }

                                    continue;
                                }

                                // existing tool call, merge if not finished
                                const toolCall = toolCalls[index];

                                if (toolCall.hasFinished) continue;

                                if (toolCallDelta.function?.name != null && !toolCall.hasStarted) {
                                    toolCall.function.name = toolCallDelta.function.name;
                                    controller.enqueue({ type: 'tool-input-start', id: toolCall.id, toolName: toolCall.function.name });
                                    toolCall.hasStarted = true;

                                    if (toolCall.function.arguments.length > 0) {
                                        controller.enqueue({
                                            type: 'tool-input-delta',
                                            id: toolCall.id,
                                            delta: toolCall.function.arguments,
                                        });
                                    }
                                }

                                if (toolCallDelta.function?.arguments != null) {
                                    toolCall.function.arguments += toolCallDelta.function.arguments;
                                }

                                if (toolCall.hasStarted && toolCallDelta.function?.arguments != null) {
                                    controller.enqueue({
                                        type: 'tool-input-delta',
                                        id: toolCall.id,
                                        delta: toolCallDelta.function.arguments,
                                    });
                                }
                            }
                        }
                    },

                    flush(controller) {
                        if (isActiveReasoning) controller.enqueue({ type: 'reasoning-end', id: 'reasoning-0' });

                        if (isActiveText) controller.enqueue({ type: 'text-end', id: 'txt-0' });

                        // go through all tool calls and send the ones that are not finished
                        for (const toolCall of toolCalls.filter((toolCall) => !toolCall.hasFinished)) {
                            if (toolCall.function.name.length === 0) {
                                throw new InvalidResponseDataError({ data: toolCall, message: `Expected 'function.name' to be a string.` });
                            }
                            controller.enqueue({
                                type: 'tool-input-end',
                                id: toolCall.id,
                            });

                            controller.enqueue({
                                type: 'tool-call',
                                toolCallId: toolCall.id ?? generateId(),
                                toolName: toolCall.function.name,
                                input: toolCall.function.arguments,
                            });
                        }

                        const metadata: JSONObject = {};
                        if (usage?.completion_tokens_details?.accepted_prediction_tokens != null) {
                            metadata.acceptedPredictionTokens = usage.completion_tokens_details.accepted_prediction_tokens;
                        }
                        if (usage?.completion_tokens_details?.rejected_prediction_tokens != null) {
                            metadata.rejectedPredictionTokens = usage.completion_tokens_details.rejected_prediction_tokens;
                        }
                        if (reasoningDetails.length > 0) {
                            metadata.reasoningDetails = reasoningDetails;
                        }
                        if (reasoningEncrypted != null) {
                            metadata.reasoningEncrypted = reasoningEncrypted;
                        }

                        const veniceUsage = convertVeniceChatUsage(usage);
                        const providerMetadata: SharedV3ProviderMetadata = {
                            [providerOptionsName]: metadata,
                            ...metadataExtractor?.buildMetadata(),
                        } as SharedV3ProviderMetadata;

                        controller.enqueue({
                            type: 'finish',
                            finishReason,
                            usage: veniceUsage,
                            providerMetadata,
                        });
                    },
                })
            ),
            request: { body },
            response: { headers: responseHeaders },
        };
    }
}
