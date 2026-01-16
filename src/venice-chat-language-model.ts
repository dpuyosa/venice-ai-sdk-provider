import type { VeniceChatResponse } from "./venice-response";
import type { VeniceLanguageModelOptions } from "./venice-chat-options";
import type { FetchFunction, ResponseHandler } from "@ai-sdk/provider-utils";
import type { MetadataExtractor, ProviderErrorStructure } from "@ai-sdk/openai-compatible";
import type { APICallError, LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Content, LanguageModelV3GenerateResult, LanguageModelV3StreamResult, SharedV3ProviderMetadata } from "@ai-sdk/provider";

import { prepareTools } from "./venice-prepare-tools";
import { convertVeniceChatUsage } from "./venice-chat-usage";
import { defaultVeniceErrorStructure } from "./venice-error";
import { veniceLanguageModelOptions } from "./venice-chat-options";
import { prepareVeniceParameters } from "./venice-prepare-parameters";
import { createOpenAICompatibleChatChunkSchema as createVeniceChatChunkSchema, VeniceChatResponseSchema } from "./venice-response";
import { convertToOpenAICompatibleChatMessages, getResponseMetadata, mapOpenAICompatibleFinishReason } from "@ai-sdk/openai-compatible/internal";
import { combineHeaders, createEventSourceResponseHandler, createJsonErrorResponseHandler, createJsonResponseHandler, generateId, parseProviderOptions, postJsonToApi } from "@ai-sdk/provider-utils";

export interface VeniceChatConfig {
    provider: string;
    headers: () => Record<string, string | undefined>;
    url: (options: { modelId: string; path: string }) => string;
    fetch?: FetchFunction;
    includeUsage?: boolean;
    errorStructure?: ProviderErrorStructure<any>;
    metadataExtractor?: MetadataExtractor;
    supportsStructuredOutputs?: boolean;
    supportedUrls?: () => LanguageModelV3["supportedUrls"];
}

export class VeniceChatLanguageModel implements LanguageModelV3 {
    readonly specificationVersion = "v3";
    readonly modelId: string;
    readonly config: VeniceChatConfig;
    private readonly failedResponseHandler: ResponseHandler<APICallError>;
    private readonly successfulResponseHandler: ResponseHandler<VeniceChatResponse>;
    private readonly successfulEventResponseHandler: ResponseHandler;
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
        return this.config.provider ?? "venice";
    }

    private get providerOptionsName(): string {
        return this.config.provider?.split(".")[0]?.trim() ?? "venice";
    }

    get supportedUrls() {
        return (
            this.config.supportedUrls?.() ?? {
                "image/*": [/^data:image\/(?:jpeg|png|webp);base64,/, /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i],
            }
        );
    }

    private async getArgs(options: LanguageModelV3CallOptions) {
        const compatibleOptions = Object.assign(
            (await parseProviderOptions({ provider: this.provider, providerOptions: options.providerOptions, schema: veniceLanguageModelOptions })) ?? {},
            (await parseProviderOptions({ provider: "openai-compatible", providerOptions: options.providerOptions, schema: veniceLanguageModelOptions })) ?? {}
        ) as VeniceLanguageModelOptions;

        const { tools: veniceTools, toolChoice: veniceToolChoice } = prepareTools({
            tools: options.tools,
            toolChoice: options.toolChoice,
        });

        return {
            model: this.modelId,

            max_completion_tokens: compatibleOptions.maxCompletionTokens ?? options.maxOutputTokens,
            temperature: options.temperature,
            top_p: options.topP,
            top_k: options.topK,
            frequency_penalty: options.frequencyPenalty,
            presence_penalty: options.presencePenalty,

            response_format:
                options.responseFormat?.type === "json"
                    ? options.responseFormat.schema != null
                        ? {
                              type: "json_schema",
                              json_schema: {
                                  schema: options.responseFormat.schema,
                                  strict: compatibleOptions.structuredOutputs ?? true,
                                  name: options.responseFormat.name ?? "response",
                                  description: options.responseFormat.description,
                              },
                          }
                        : { type: "json_object" }
                    : undefined,

            stop: options.stopSequences,
            stop_token_ids: compatibleOptions.stopTokenIds,
            seed: options.seed,

            reasoning: undefined,
            reasoning_effort: compatibleOptions.reasoningEffort ?? compatibleOptions.reasoning?.effort,

            messages: convertToOpenAICompatibleChatMessages(options.prompt),

            tools: veniceTools,
            tool_choice: veniceToolChoice,

            venice_parameters: prepareVeniceParameters({ veniceParameters: compatibleOptions.veniceParameters }),

            logprobs: compatibleOptions.logprobs,
            top_logprobs: compatibleOptions.topLogprobs,
            max_temp: compatibleOptions.maxTemp,
            min_temp: compatibleOptions.minTemp,
            min_p: compatibleOptions.minP,
            n: compatibleOptions.n,
            user: compatibleOptions.user,
            stream: compatibleOptions.stream,
            stream_options: compatibleOptions.streamOptions,
            repetition_penalty: compatibleOptions.repetitionPenalty,
            prompt_cache_key: compatibleOptions.promptCacheKey,
        };
    }

    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
        const body = await this.getArgs(options);
        const {
            responseHeaders,
            value: responseBody,
            rawValue: rawResponse,
        } = await postJsonToApi({
            url: this.config.url({ path: "/chat/completions", modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const choice = responseBody.choices[0];
        const content: Array<LanguageModelV3Content> = [];

        const text = choice?.message.content ?? null;
        if (text != null && text.length > 0) content.push({ type: "text", text });

        const reasoning = choice?.message.reasoning_content ?? choice?.message.reasoning ?? null;
        if (reasoning != null && reasoning.length > 0) content.push({ type: "reasoning", text: reasoning });

        if (choice?.message?.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                const thoughtSignature = toolCall.extra_content?.google?.thought_signature;
                ({
                    type: "tool-call",
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments!,
                    ...(thoughtSignature ? { providerMetadata: { [this.providerOptionsName]: { thoughtSignature } } } : {}),
                });
            }
        }

        const providerMetadata: SharedV3ProviderMetadata = {
            [this.providerOptionsName]: {},
            ...(await this.config.metadataExtractor?.extractMetadata?.({ parsedBody: rawResponse })),
        };

        return {
            content,
            finishReason: {
                unified: mapOpenAICompatibleFinishReason(choice?.finish_reason),
                raw: choice?.finish_reason ?? undefined,
            },
            usage: convertVeniceChatUsage(responseBody.usage),
            providerMetadata,
            request: { body },
            response: {
                ...getResponseMetadata(responseBody),
                headers: responseHeaders,
                body: rawResponse,
            },
            warnings: [],
        };
    }

    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        const body = await this.getArgs(options);
        body.stream = true;
        body.stream_options = this.config.includeUsage ? { includeUsage: true } : undefined;

        const metadataExtractor = this.config.metadataExtractor?.createStreamExtractor();

        const { responseHeaders, value: response } = await postJsonToApi({
            url: this.config.url({ path: "/chat/completions", modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulEventResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        return {
            stream: response.body!,
        };
    }
}
