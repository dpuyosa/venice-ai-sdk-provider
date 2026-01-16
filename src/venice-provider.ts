import { type ProviderV3 } from "@ai-sdk/provider";
import { OpenAICompatibleEmbeddingModel, OpenAICompatibleImageModel } from "@ai-sdk/openai-compatible";
import { type FetchFunction, loadApiKey, withoutTrailingSlash, withUserAgentSuffix } from "@ai-sdk/provider-utils";

import { VeniceChatLanguageModel } from "./venice-chat-language-model";
import { VERSION } from "./version";

export interface VeniceProviderSettings {
    /**
     *Provider name.
     */
    name?: string;

    /**
     * API key for authentication
     */
    apiKey?: string;

    /**
     * Base URL for API calls
     */
    baseURL?: string;

    /**
     * Custom headers for requests
     */
    headers?: Record<string, string>;

    /**
     *Optional custom url query parameters to include in request urls.
     */
    queryParams?: Record<string, string>;

    /**
     * Custom fetch implementation
     */
    fetch?: FetchFunction;

    /**
     * Include usage information in streaming responses.
     */
    includeUsage?: boolean;

    /**
     * Whether the provider supports structured outputs in chat models.
     */
    supportsStructuredOutputs?: boolean;
}

export interface VeniceProvider extends ProviderV3 {
    (modelId: string): VeniceChatLanguageModel;
    languageModel(modelId: string): VeniceChatLanguageModel;
    chatModel(modelId: string): VeniceChatLanguageModel;

    imageModel(modelId: string): OpenAICompatibleImageModel;
    embeddingModel(modelId: string): OpenAICompatibleEmbeddingModel;
}

export function createVenice(options: VeniceProviderSettings = {}): VeniceProvider {
    const baseURL = withoutTrailingSlash(options.baseURL ?? "https://api.venice.ai/v1");
    const providerName = options.name ?? "venice";

    const getHeaders = () =>
        withUserAgentSuffix(
            {
                Authorization: `Bearer ${loadApiKey({
                    apiKey: options.apiKey,
                    environmentVariableName: "VENICE_API_KEY",
                    description: "Venice Provider API key",
                })}`,
                ...options.headers,
            },
            `ai-sdk/venice/${VERSION}`
        );

    const getCommonModelConfig = (modelType: string) => ({
        provider: `${providerName}.${modelType}`,
        url: ({ path }: { path: string }) => {
            const url = new URL(`${baseURL}${path}`);
            if (options.queryParams) {
                url.search = new URLSearchParams(options.queryParams).toString();
            }
            return url.toString();
        },
        headers: getHeaders,
        fetch: options.fetch,
    });

    const createLanguageModel = (modelId: string) => createChatModel(modelId);

    const createChatModel = (modelId: string) =>
        new VeniceChatLanguageModel(modelId, {
            ...getCommonModelConfig("chat"),
            includeUsage: options.includeUsage,
            supportsStructuredOutputs: options.supportsStructuredOutputs,
        });

    const createImageModel = (modelId: string) => new OpenAICompatibleImageModel(modelId, getCommonModelConfig("image"));
    const createEmbeddingModel = (modelId: string) => new OpenAICompatibleEmbeddingModel(modelId, getCommonModelConfig("embedding"));

    const provider = (modelId: string) => createChatModel(modelId);
    provider.specificationVersion = "v3" as const;
    provider.languageModel = createLanguageModel;
    provider.chatModel = createChatModel;

    provider.imageModel = createImageModel;
    provider.embeddingModel = createEmbeddingModel;

    return provider as VeniceProvider;
}

export const venice = createVenice();
