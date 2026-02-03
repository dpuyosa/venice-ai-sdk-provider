import type { z } from 'zod/v4';
import type { VeniceLanguageModelOptions } from './venice-chat-options';
import type { FetchFunction, ParseResult, ResponseHandler } from '@ai-sdk/provider-utils';
import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';
import type { VeniceChatResponse, veniceChunkSchema, VeniceTokenUsage } from './venice-response';
import type { APICallError, LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2Content, LanguageModelV2FinishReason, LanguageModelV2StreamPart, SharedV2ProviderMetadata } from '@ai-sdk/provider';

import { prepareTools } from './venice-prepare-tools';
import { InvalidResponseDataError } from '@ai-sdk/provider';
import { convertVeniceChatUsage } from './venice-chat-usage';
import { defaultVeniceErrorStructure } from './venice-error';
import { veniceLanguageModelOptionsSchema } from './venice-chat-options';
import { prepareVeniceParameters } from './venice-prepare-parameters';
import { convertToVeniceChatMessages } from './convert-to-venice-chat-messages';
import { createVeniceChatChunkSchema, VeniceChatResponseSchema } from './venice-response';
import { getResponseMetadata, mapOpenAICompatibleFinishReason } from '@ai-sdk/openai-compatible/internal';
import { combineHeaders, createEventSourceResponseHandler, createJsonErrorResponseHandler, createJsonResponseHandler, generateId, isParsableJson, parseProviderOptions, postJsonToApi } from '@ai-sdk/provider-utils';

export interface VeniceChatConfig {
    provider: string;
    headers: () => Record<string, string | undefined>;
    url: (options: { modelId: string; path: string }) => string;
    fetch?: FetchFunction;
    includeUsage?: boolean;
    errorStructure?: ProviderErrorStructure<any>;
    supportsStructuredOutputs?: boolean;
    supportedUrls?: () => LanguageModelV2['supportedUrls'];
}

function mockReasoningChunk(isMocking: boolean, delta: any) {
    if ((!isMocking && delta.content?.trimStart().startsWith('<think>')) || isMocking) {
        let mocking = delta.content?.trimEnd().endsWith('</think>') ? false : true;

        if (delta.content?.trimStart().startsWith('<think>')) delta.content = delta.content?.replace('<think>', '');
        if (delta.content?.trimEnd().endsWith('</think>')) delta.content = delta.content?.replace('</think>', '');

        delta.reasoning_content = delta.content;
        delta.content = null;
        return mocking;
    }
    return false;
}

export class VeniceChatLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = 'v2';
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
                'image/*': [/^data:image\/(?:jpeg|png|webp);base64,/, /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i],
            }
        );
    }

    private async getArgs(options: LanguageModelV2CallOptions) {
        const compatibleOptions = Object.assign(
            (await parseProviderOptions({ provider: this.providerOptionsName, providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {},
            (await parseProviderOptions({ provider: 'openai-compatible', providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {}
        ) as VeniceLanguageModelOptions;

        const { tools: veniceTools, toolChoice: veniceToolChoice } = prepareTools({
            tools: options.tools,
            toolChoice: options.toolChoice,
        });

        return {
            args: {
                model: this.modelId,

                n: compatibleOptions.n,
                user: compatibleOptions.user,
                max_completion_tokens: compatibleOptions.maxCompletionTokens ?? options.maxOutputTokens,
                stream: compatibleOptions.stream,
                stream_options: compatibleOptions.streamOptions,

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

                reasoning: undefined,
                reasoning_effort: compatibleOptions.reasoningEffort ?? compatibleOptions.reasoning?.effort,
                prompt_cache_key: compatibleOptions.promptCacheKey,

                venice_parameters: prepareVeniceParameters({ veniceParameters: compatibleOptions.veniceParameters }),
                response_format:
                    options.responseFormat?.type === 'json'
                        ? options.responseFormat.schema != null
                            ? {
                                  type: 'json_schema',
                                  json_schema: {
                                      schema: options.responseFormat.schema,
                                      strict: compatibleOptions.structuredOutputs ?? true,
                                      name: options.responseFormat.name ?? 'response',
                                      description: options.responseFormat.description,
                                  },
                              }
                            : { type: 'json_object' }
                        : undefined,

                tool_choice: veniceToolChoice,
                tools: veniceTools,

                messages: convertToVeniceChatMessages(options.prompt, this.modelId),
            },
            warnings: [],
        };
    }

    async doGenerate(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
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
        const content: Array<LanguageModelV2Content> = [];
        const providerOptionsName = this.providerOptionsName;

        const text = choice?.message.content ?? null;
        if (text != null && text.length > 0) content.push({ type: 'text', text });

        const reasoning = choice?.message.reasoning_content ?? choice?.message.reasoning ?? null;
        if (reasoning != null && reasoning.length > 0) content.push({ type: 'reasoning', text: reasoning });

        if (choice?.message?.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                const thoughtSignature = toolCall.extra_content?.google?.thought_signature;
                content.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments!,
                    ...(thoughtSignature ? { providerMetadata: { [providerOptionsName]: { thoughtSignature } } } : {}),
                });
            }
        }

        const veniceUsage = convertVeniceChatUsage(responseBody.usage);
        const providerMetadata: SharedV2ProviderMetadata = {
            [providerOptionsName]: veniceUsage ? { usage: veniceUsage } : {},
        } as SharedV2ProviderMetadata;

        return {
            content,
            finishReason: mapOpenAICompatibleFinishReason(choice?.finish_reason) ?? 'other',
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

    async doStream(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
        const { args, warnings } = await this.getArgs(options);
        const body = {
            ...args,
            stream: true,
            stream_options: this.config.includeUsage ? { includeUsage: true } : undefined,
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
            thoughtSignature?: string;
        }> = [];

        let finishReason: LanguageModelV2FinishReason = 'other';

        const providerOptionsName = this.providerOptionsName;
        let usage: VeniceTokenUsage = undefined;
        let isFirstChunk = true;
        let isActiveText = false;
        let isActiveReasoning = false;
        let isMockReasoning = false;

        return {
            stream: response.pipeThrough(
                new TransformStream<ParseResult<z.infer<typeof this.chunkSchema>>, LanguageModelV2StreamPart>({
                    start(controller) {
                        controller.enqueue({ type: 'stream-start', warnings });
                    },

                    transform(chunk, controller) {
                        if (options.includeRawChunks) {
                            controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
                        }

                        if (!chunk.success) {
                            finishReason = 'error';
                            controller.enqueue({ type: 'error', error: chunk.error });
                            return;
                        }

                        if ('error' in chunk.value) {
                            finishReason = 'error';
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
                            finishReason = mapOpenAICompatibleFinishReason(choice.finish_reason) ?? 'other';
                        }

                        if (choice?.delta == null) {
                            return;
                        }

                        const delta = choice.delta;
                        isMockReasoning = mockReasoningChunk(isMockReasoning, delta);

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

                                    if (toolCallDelta.function?.name == null) {
                                        throw new InvalidResponseDataError({
                                            data: toolCallDelta,
                                            message: `Expected 'function.name' to be a string.`,
                                        });
                                    }

                                    controller.enqueue({
                                        type: 'tool-input-start',
                                        id: toolCallDelta.id,
                                        toolName: toolCallDelta.function.name,
                                    });

                                    toolCalls[index] = {
                                        id: toolCallDelta.id,
                                        type: 'function',
                                        function: {
                                            name: toolCallDelta.function.name,
                                            arguments: toolCallDelta.function.arguments ?? '',
                                        },
                                        hasFinished: false,
                                        thoughtSignature: toolCallDelta.extra_content?.google?.thought_signature ?? undefined,
                                    };

                                    const toolCall = toolCalls[index];

                                    if (toolCall.function?.name != null && toolCall.function?.arguments != null) {
                                        // send delta if the argument text has already started:
                                        if (toolCall.function.arguments.length > 0) {
                                            controller.enqueue({
                                                type: 'tool-input-delta',
                                                id: toolCall.id,
                                                delta: toolCall.function.arguments,
                                            });
                                        }

                                        // check if tool call is complete
                                        // (some providers send the full tool call in one chunk):
                                        if (isParsableJson(toolCall.function.arguments)) {
                                            controller.enqueue({
                                                type: 'tool-input-end',
                                                id: toolCall.id,
                                            });

                                            controller.enqueue({
                                                type: 'tool-call',
                                                toolCallId: toolCall.id ?? generateId(),
                                                toolName: toolCall.function.name,
                                                input: toolCall.function.arguments,
                                                ...(toolCall.thoughtSignature
                                                    ? {
                                                          providerMetadata: {
                                                              [providerOptionsName]: {
                                                                  thoughtSignature: toolCall.thoughtSignature,
                                                              },
                                                          },
                                                      }
                                                    : {}),
                                            });
                                            toolCall.hasFinished = true;
                                        }
                                    }

                                    continue;
                                }

                                // existing tool call, merge if not finished
                                const toolCall = toolCalls[index];

                                if (toolCall.hasFinished) continue;

                                if (toolCallDelta.function?.arguments != null) toolCall.function!.arguments += toolCallDelta.function?.arguments ?? '';

                                // send delta
                                controller.enqueue({
                                    type: 'tool-input-delta',
                                    id: toolCall.id,
                                    delta: toolCallDelta.function.arguments ?? '',
                                });

                                // check if tool call is complete
                                if (toolCall.function?.name != null && toolCall.function?.arguments != null && isParsableJson(toolCall.function.arguments)) {
                                    controller.enqueue({
                                        type: 'tool-input-end',
                                        id: toolCall.id,
                                    });

                                    controller.enqueue({
                                        type: 'tool-call',
                                        toolCallId: toolCall.id ?? generateId(),
                                        toolName: toolCall.function.name,
                                        input: toolCall.function.arguments,
                                        ...(toolCall.thoughtSignature
                                            ? {
                                                  providerMetadata: {
                                                      [providerOptionsName]: {
                                                          thoughtSignature: toolCall.thoughtSignature,
                                                      },
                                                  },
                                              }
                                            : {}),
                                    });
                                    toolCall.hasFinished = true;
                                }
                            }
                        }
                    },

                    flush(controller) {
                        if (isActiveReasoning) controller.enqueue({ type: 'reasoning-end', id: 'reasoning-0' });

                        if (isActiveText) controller.enqueue({ type: 'text-end', id: 'txt-0' });

                        // go through all tool calls and send the ones that are not finished
                        for (const toolCall of toolCalls.filter((toolCall) => !toolCall.hasFinished)) {
                            controller.enqueue({
                                type: 'tool-input-end',
                                id: toolCall.id,
                            });

                            controller.enqueue({
                                type: 'tool-call',
                                toolCallId: toolCall.id ?? generateId(),
                                toolName: toolCall.function.name,
                                input: toolCall.function.arguments,
                                ...(toolCall.thoughtSignature
                                    ? {
                                          providerMetadata: {
                                              [providerOptionsName]: {
                                                  thoughtSignature: toolCall.thoughtSignature,
                                              },
                                          },
                                      }
                                    : {}),
                            });
                        }

                        const veniceUsage = convertVeniceChatUsage(usage);
                        const providerMetadata: SharedV2ProviderMetadata = {
                            [providerOptionsName]: veniceUsage ? { usage: veniceUsage } : {},
                        } as SharedV2ProviderMetadata;

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
