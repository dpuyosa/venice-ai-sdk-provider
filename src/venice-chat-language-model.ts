import type { VeniceChatResponse } from "./venice-response";
import type { VeniceLanguageModelOptions } from "./venice-chat-options";
import type { FetchFunction, ResponseHandler } from "@ai-sdk/provider-utils";
import type { MetadataExtractor, ProviderErrorStructure } from "@ai-sdk/openai-compatible";
import type { APICallError, LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from "@ai-sdk/provider";

import { prepareTools } from "./venice-prepare-tools";
import { defaultVeniceErrorStructure } from "./venice-error";
import { VeniceChatResponseSchema } from "./venice-response";
import { veniceLanguageModelOptions } from "./venice-chat-options";
import { prepareVeniceParameters } from "./venice-prepare-parameters";
import { combineHeaders, createJsonErrorResponseHandler, createJsonResponseHandler, parseProviderOptions, postJsonToApi } from "@ai-sdk/provider-utils";

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
    private readonly chunkSchema;

    constructor(modelId: string, config: VeniceChatConfig) {
        this.modelId = modelId;
        this.config = config;

        const errorStructure = config.errorStructure ?? defaultVeniceErrorStructure;

        this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure);
        this.successfulResponseHandler = createJsonResponseHandler(VeniceChatResponseSchema);

        this.chunkSchema = createOpenAICompatibleChatChunkSchema(errorStructure.errorSchema);
    }

    get provider(): string {
        return this.config.provider ?? "venice";
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

            messages: convertToVeniceChatMessages(prompt),

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
        const response = await postJsonToApi({
            url: this.config.url({ path: "/chat/completions", modelId: this.modelId }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: response.choices[0].message.content,
                },
            ],
            finishReason: response.choices[0].finish_reason,
            usage: {
                inputTokens: response.usage?.prompt_tokens,
                outputTokens: response.usage?.completion_tokens,
            },
            request: { body },
            response: { body: response },
        };
    }

    async doStream(options: LanguageModelV3CallOptions) {
        const body = { ...this.getArgs(options), stream: true };

        const response = await fetch(`${this.config.baseURL}/chat/completions`, {
            method: "POST",
            headers: {
                ...this.config.headers(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: options.abortSignal,
        });

        return {
            stream: response.body!,
        };
    }
}
