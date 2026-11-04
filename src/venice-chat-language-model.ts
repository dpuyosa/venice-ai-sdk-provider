import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';
import type {
    APICallError,
    JSONObject,
    LanguageModelV3,
    LanguageModelV3CallOptions,
    LanguageModelV3Content,
    LanguageModelV3FinishReason,
    LanguageModelV3StreamPart,
    LanguageModelV3Usage,
    SharedV3ProviderMetadata,
    SharedV3Warning,
} from '@ai-sdk/provider';
import { InvalidResponseDataError } from '@ai-sdk/provider';
import type { FetchFunction, ParseResult, ResponseHandler, StreamingToolCallDelta } from '@ai-sdk/provider-utils';
import { combineHeaders, createEventSourceResponseHandler, createJsonErrorResponseHandler, createJsonResponseHandler, generateId, parseProviderOptions, postJsonToApi, StreamingToolCallTracker } from '@ai-sdk/provider-utils';
import type { z } from 'zod/v4';
import { convertToVeniceChatMessages } from './convert-to-venice-chat-messages';
import { getResponseMetadata } from './get-response-metadata';
import { mapFinishReason } from './map-finish-reason';
import type { VeniceLanguageModelOptions } from './venice-chat-options';
import { veniceLanguageModelOptionsSchema } from './venice-chat-options';
import { convertVeniceChatUsage } from './venice-chat-usage';
import { defaultVeniceErrorStructure, getVeniceErrorMessage } from './venice-error';
import type { MetadataExtractor } from './venice-metadata-extractor';
import { prepareVeniceParameters } from './venice-prepare-parameters';
import { prepareTools } from './venice-prepare-tools';
import type { VeniceChatResponse, VeniceContent, VeniceTokenUsage, veniceChunkSchema } from './venice-response';
import { createVeniceChatChunkSchema, VeniceChatResponseSchema } from './venice-response';

type VeniceStreamingToolCallDelta = StreamingToolCallDelta & {
    thought_signature?: string | null;
    extra_content?: {
        google?: {
            thought_signature?: string | null;
        } | null;
    } | null;
};

type PendingToolCall = {
    id: string | null;
    type: string | null;
    bufferedArguments: string;
    thoughtSignature: string | undefined;
};

function getToolCallThoughtSignature(toolCall: Pick<VeniceStreamingToolCallDelta, 'thought_signature' | 'extra_content'>): string | undefined {
    return toolCall.thought_signature ?? toolCall.extra_content?.google?.thought_signature ?? undefined;
}

function toProviderMetadataProps(metadataKey: string, metadata: JSONObject): { providerMetadata?: SharedV3ProviderMetadata } {
    return Object.keys(metadata).length > 0 ? { providerMetadata: { [metadataKey]: metadata } } : {};
}

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
    transformRequestBody?: (args: Record<string, unknown>) => Record<string, unknown>;
    convertUsage?: (usage: VeniceTokenUsage) => LanguageModelV3Usage;
}

function toCamelCase(str: string): string {
    return str.replace(/[_-]([a-z])/g, (group) => group.charAt(1).toUpperCase());
}

/**
 * Uses the camelCase providerOptions key for providerMetadata when the caller supplied it.
 */
function resolveProviderOptionsKey(rawName: string, providerOptions: Record<string, unknown> | undefined): string {
    const camelName = toCamelCase(rawName);
    if (camelName !== rawName && providerOptions?.[camelName] != null) {
        return camelName;
    }
    return rawName;
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

function convertVeniceContent(content: VeniceContent): Array<Extract<LanguageModelV3Content, { type: 'text' | 'reasoning' }>> {
    if (content == null) {
        return [];
    }

    if (typeof content === 'string') {
        return content.length > 0 ? [{ type: 'text', text: content }] : [];
    }

    const result: Array<Extract<LanguageModelV3Content, { type: 'text' | 'reasoning' }>> = [];

    for (const part of content) {
        if (part.type === 'text' && typeof part.text === 'string') {
            if (part.text.length > 0) {
                result.push({ type: 'text', text: part.text });
            }
        } else if (part.type === 'thinking' && Array.isArray(part.thinking)) {
            const reasoningText = part.thinking
                .filter((chunk) => chunk != null && typeof chunk === 'object' && chunk.type === 'text' && typeof chunk.text === 'string')
                .map((chunk) => chunk.text)
                .join('');

            if (reasoningText.length > 0) {
                result.push({ type: 'reasoning', text: reasoningText });
            }
        }
    }

    return result;
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
        this.successfulEventResponseHandler = createEventSourceResponseHandler(this.chunkSchema);
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

        // Merge: deprecated < openaiCompatible < raw provider name < camelCase provider name
        const compatibleOptions = Object.assign(
            deprecatedOptions ?? {},
            (await parseProviderOptions({ provider: 'openaiCompatible', providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {},
            (await parseProviderOptions({ provider: this.providerOptionsName, providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {},
            (await parseProviderOptions({ provider: toCamelCase(this.providerOptionsName), providerOptions: options.providerOptions, schema: veniceLanguageModelOptionsSchema })) ?? {}
        ) as VeniceLanguageModelOptions;

        const providerOptionsKey = this.providerOptionsName;
        const camelCaseProviderOptionsKey = toCamelCase(providerOptionsKey);
        const metadataKey = resolveProviderOptionsKey(providerOptionsKey, options.providerOptions);
        const supportsStructuredOutputs = compatibleOptions.structuredOutputs ?? this.config.supportsStructuredOutputs ?? false;

        if (compatibleOptions.n != null && compatibleOptions.n > 1) {
            warnings.push({
                type: 'other',
                message: `The Venice API supports multiple choices, but this LanguageModelV3 adapter exposes one completion; provider option 'n' was reduced from ${compatibleOptions.n} to 1.`,
            });
        }

        if (options.responseFormat?.type === 'json' && options.responseFormat.schema != null && !supportsStructuredOutputs) {
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
        const rawProviderOptions = Object.entries({
            ...options.providerOptions?.[providerOptionsKey],
            ...options.providerOptions?.[camelCaseProviderOptionsKey],
        });
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
            ...(compatibleOptions.reasoningEffort !== undefined ? { reasoning_effort: compatibleOptions.reasoningEffort } : {}),
            verbosity: compatibleOptions.verbosity ?? compatibleOptions.textVerbosity,
            prompt_cache_key: compatibleOptions.promptCacheKey,
            prompt_cache_retention: compatibleOptions.promptCacheRetention,

            parallel_tool_calls: compatibleOptions.parallelToolCalls,

            venice_parameters: prepareVeniceParameters({ veniceParameters: compatibleOptions.veniceParameters }),
            response_format:
                options.responseFormat?.type === 'json'
                    ? options.responseFormat.schema != null && supportsStructuredOutputs === true
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
            metadataKey,
        };
    }

    async doGenerate(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
        const { args, warnings, metadataKey } = await this.getArgs(options);
        const untransformedBody = { ...args, stream: false };
        const body = this.config.transformRequestBody?.(untransformedBody) ?? untransformedBody;

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
        if (choice == null) {
            throw new InvalidResponseDataError({
                data: rawResponse,
                message: 'Response did not contain any choices.',
            });
        }

        const message = choice.message;
        const content: Array<LanguageModelV3Content> = [];

        const reasoning = message.reasoning_content ?? message.reasoning ?? null;
        const hasReasoningPart = reasoning != null && reasoning.length > 0;
        const reasoningDetails = message.reasoning_details?.length ? message.reasoning_details : undefined;
        const messageThoughtSignature = message.thought_signature != null && message.thought_signature.length > 0 ? message.thought_signature : undefined;

        if (hasReasoningPart) {
            const reasoningMetadata: JSONObject = {};
            if (reasoningDetails != null) reasoningMetadata.reasoningDetails = reasoningDetails;
            if (messageThoughtSignature != null) reasoningMetadata.thoughtSignature = messageThoughtSignature;

            content.push({
                type: 'reasoning',
                text: reasoning,
                ...toProviderMetadataProps(metadataKey, reasoningMetadata),
            });
        }

        const messageContent = convertVeniceContent(message.content);
        content.push(...messageContent);

        const toolCalls = message.tool_calls ?? [];
        toolCalls.forEach((toolCall, index) => {
            const thoughtSignature = getToolCallThoughtSignature(toolCall);
            const toolCallMetadata: JSONObject = {};
            if (thoughtSignature != null) toolCallMetadata.thoughtSignature = thoughtSignature;

            // Preserve reasoning_details on the first tool call when the model emits no reasoning text,
            // so they can be round-tripped through the assistant message.
            if (!hasReasoningPart && index === 0 && reasoningDetails != null) {
                toolCallMetadata.reasoningDetails = reasoningDetails;
                if (messageThoughtSignature != null && thoughtSignature == null) {
                    toolCallMetadata.thoughtSignature = messageThoughtSignature;
                }
            }

            content.push({
                type: 'tool-call',
                toolCallId: toolCall.id ?? generateId(),
                toolName: toolCall.function.name,
                input: toolCall.function.arguments,
                ...toProviderMetadataProps(metadataKey, toolCallMetadata),
            });
        });

        if (!hasReasoningPart && toolCalls.length === 0 && messageThoughtSignature != null) {
            const lastTextPart = messageContent.findLast((part) => part.type === 'text');
            if (lastTextPart != null) {
                lastTextPart.providerMetadata = { [metadataKey]: { thoughtSignature: messageThoughtSignature } };
            }
        }

        const extractedMetadata = await this.config.metadataExtractor?.extractMetadata?.({ parsedBody: rawResponse });
        const providerMetadata: SharedV3ProviderMetadata = {
            ...extractedMetadata,
            [metadataKey]: { ...(extractedMetadata?.[metadataKey] ?? {}) },
        };

        const metadata = providerMetadata[metadataKey] ?? {};

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
                unified: mapFinishReason(choice.finish_reason) ?? 'other',
                raw: choice.finish_reason ?? undefined,
            },
            usage: this.config.convertUsage?.(responseBody.usage) ?? convertVeniceChatUsage(responseBody.usage),
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
        const { args, warnings, metadataKey } = await this.getArgs(options);
        const untransformedBody = {
            ...args,
            stream: true,
            stream_options: args.stream_options ?? (this.config.includeUsage ? { include_usage: true } : undefined),
        };
        const body = this.config.transformRequestBody?.(untransformedBody) ?? untransformedBody;

        const { responseHeaders, value: response } = await postJsonToApi({
            url: this.config.url({ path: '/chat/completions', modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulEventResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const convertUsage = (tokenUsage: VeniceTokenUsage): LanguageModelV3Usage => this.config.convertUsage?.(tokenUsage) ?? convertVeniceChatUsage(tokenUsage);

        let toolCallTracker: StreamingToolCallTracker<VeniceStreamingToolCallDelta>;

        // Buffers tool-call deltas by `index` until `function.name` is known: some
        // OpenAI-compatible providers send the first delta without a name.
        const pendingToolCalls = new Map<number, PendingToolCall>();
        const forwardedToolCallIndices = new Set<number>();

        const processToolCallDelta = (toolCallDelta: VeniceStreamingToolCallDelta) => {
            const index = toolCallDelta.index;

            if (index == null || forwardedToolCallIndices.has(index)) {
                toolCallTracker.processDelta(toolCallDelta);
                return;
            }

            let pending = pendingToolCalls.get(index);
            if (pending == null) {
                pending = {
                    id: toolCallDelta.id ?? null,
                    type: toolCallDelta.type ?? null,
                    bufferedArguments: '',
                    thoughtSignature: getToolCallThoughtSignature(toolCallDelta),
                };
                pendingToolCalls.set(index, pending);
            } else {
                if (pending.id == null && toolCallDelta.id != null) {
                    pending.id = toolCallDelta.id;
                }
                if (pending.type == null && toolCallDelta.type != null) {
                    pending.type = toolCallDelta.type;
                }
                if (pending.thoughtSignature == null) {
                    pending.thoughtSignature = getToolCallThoughtSignature(toolCallDelta);
                }
            }

            const argumentsDelta = toolCallDelta.function?.arguments;
            if (argumentsDelta != null) {
                pending.bufferedArguments += argumentsDelta;
            }

            const name = toolCallDelta.function?.name;
            if (name != null) {
                toolCallTracker.processDelta({
                    index,
                    id: pending.id,
                    type: pending.type,
                    thought_signature: pending.thoughtSignature,
                    function: { name, arguments: pending.bufferedArguments },
                });
                pendingToolCalls.delete(index);
                forwardedToolCallIndices.add(index);
            }
        };

        let finishReason: LanguageModelV3FinishReason | undefined;

        const metadataExtractor = this.config.metadataExtractor?.createStreamExtractor();
        let usage: VeniceTokenUsage;
        let isFirstChunk = true;
        let isActiveText = false;
        let isActiveReasoning = false;
        let reasoningDetails: NonNullable<VeniceChatResponse['choices'][number]['message']['reasoning_details']> = [];
        let reasoningEncrypted: boolean | undefined;
        let streamThoughtSignature: string | undefined;
        let hasAttachedReasoningDetails = false;
        let hasAttachedReasoningEncrypted = false;
        let hasAttachedThoughtSignature = false;
        let isFirstToolCall = true;

        const takePartMetadata = (): JSONObject => {
            const metadata: JSONObject = {};

            if (reasoningDetails.length > 0 && !hasAttachedReasoningDetails) {
                metadata.reasoningDetails = reasoningDetails;
                hasAttachedReasoningDetails = true;
            }
            if (reasoningEncrypted != null && !hasAttachedReasoningEncrypted) {
                metadata.reasoningEncrypted = reasoningEncrypted;
                hasAttachedReasoningEncrypted = true;
            }
            if (streamThoughtSignature != null && !hasAttachedThoughtSignature) {
                metadata.thoughtSignature = streamThoughtSignature;
                hasAttachedThoughtSignature = true;
            }

            return metadata;
        };

        const partMetadata = () => toProviderMetadataProps(metadataKey, takePartMetadata());

        return {
            stream: response.pipeThrough(
                new TransformStream<ParseResult<z.infer<typeof this.chunkSchema>>, LanguageModelV3StreamPart>({
                    start(controller) {
                        toolCallTracker = new StreamingToolCallTracker<VeniceStreamingToolCallDelta>(controller, {
                            generateId,
                            typeValidation: 'if-present',
                            extractMetadata: (delta) => {
                                const thoughtSignature = getToolCallThoughtSignature(delta);
                                const metadata: JSONObject = {};

                                if (thoughtSignature != null) {
                                    metadata.thoughtSignature = thoughtSignature;
                                    hasAttachedThoughtSignature = true;
                                }

                                if (isFirstToolCall) {
                                    isFirstToolCall = false;
                                    Object.assign(metadata, takePartMetadata());
                                }

                                return toProviderMetadataProps(metadataKey, metadata).providerMetadata;
                            },
                            buildToolCallProviderMetadata: (metadata) => metadata,
                        });

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
                            controller.enqueue({ type: 'error', error: getVeniceErrorMessage(chunk.value) });
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

                        if (delta.thought_signature != null) {
                            streamThoughtSignature = delta.thought_signature;
                        }

                        const enqueueReasoningDelta = (reasoningDelta: string) => {
                            if (isActiveText) {
                                controller.enqueue({ type: 'text-end', id: 'txt-0' });
                                isActiveText = false;
                            }

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
                                delta: reasoningDelta,
                            });
                        };

                        const enqueueTextDelta = (textDelta: string) => {
                            // end active reasoning block before text starts
                            if (isActiveReasoning) {
                                controller.enqueue({
                                    type: 'reasoning-end',
                                    id: 'reasoning-0',
                                    ...partMetadata(),
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
                                delta: textDelta,
                            });
                        };

                        const reasoningContent = delta.reasoning_content ?? delta.reasoning;
                        if (reasoningContent) {
                            enqueueReasoningDelta(reasoningContent);
                        }

                        for (const contentPart of convertVeniceContent(delta.content)) {
                            if (contentPart.type === 'reasoning') {
                                enqueueReasoningDelta(contentPart.text);
                            } else {
                                enqueueTextDelta(contentPart.text);
                            }
                        }

                        if (delta.tool_calls != null && delta.tool_calls.length > 0) {
                            // end active reasoning block before tool calls start
                            if (isActiveReasoning) {
                                controller.enqueue({
                                    type: 'reasoning-end',
                                    id: 'reasoning-0',
                                    ...partMetadata(),
                                });
                                isActiveReasoning = false;
                            }

                            for (const toolCallDelta of delta.tool_calls) {
                                processToolCallDelta(toolCallDelta);
                            }
                        }
                    },

                    flush(controller) {
                        if (isActiveReasoning) {
                            controller.enqueue({ type: 'reasoning-end', id: 'reasoning-0', ...partMetadata() });
                        }

                        if (isActiveText) {
                            controller.enqueue({ type: 'text-end', id: 'txt-0', ...partMetadata() });
                        }

                        // Forward deltas that never received a name so the tracker keeps its
                        // invalid-response behavior for incomplete tool calls.
                        for (const [index, pending] of pendingToolCalls) {
                            toolCallTracker.processDelta({
                                index,
                                id: pending.id,
                                type: pending.type,
                                thought_signature: pending.thoughtSignature,
                                function: { arguments: pending.bufferedArguments },
                            });
                        }
                        pendingToolCalls.clear();

                        toolCallTracker.flush();

                        if (finishReason == null) {
                            finishReason = { unified: 'error', raw: undefined };
                            controller.enqueue({
                                type: 'error',
                                error: new InvalidResponseDataError({
                                    data: undefined,
                                    message: 'Response stream ended without a finish reason.',
                                }),
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

                        const extractedMetadata = metadataExtractor?.buildMetadata();
                        const providerMetadata: SharedV3ProviderMetadata = {
                            ...extractedMetadata,
                            [metadataKey]: {
                                ...(extractedMetadata?.[metadataKey] ?? {}),
                                ...metadata,
                            },
                        };

                        controller.enqueue({
                            type: 'finish',
                            finishReason,
                            usage: convertUsage(usage),
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
