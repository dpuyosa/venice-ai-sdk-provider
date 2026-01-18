import type { ProviderV2 } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';

import { VERSION } from './version';
import { VeniceChatLanguageModel } from './venice-chat-language-model';
import { loadApiKey, withoutTrailingSlash, withUserAgentSuffix } from '@ai-sdk/provider-utils';
import { OpenAICompatibleCompletionLanguageModel, OpenAICompatibleEmbeddingModel, OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible';

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

export interface VeniceProvider extends ProviderV2 {
    (modelId: string): VeniceChatLanguageModel;
    languageModel(modelId: string): VeniceChatLanguageModel;
    chatModel(modelId: string): VeniceChatLanguageModel;

    imageModel(modelId: string): OpenAICompatibleImageModel;
    embeddingModel(modelId: string): OpenAICompatibleEmbeddingModel;
}

export function createVenice(options: VeniceProviderSettings = {}): VeniceProvider {
    const baseURL = withoutTrailingSlash(options.baseURL ?? 'https://api.venice.ai/v1');
    const providerName = options.name ?? 'venice';

    const getHeaders = () =>
        withUserAgentSuffix(
            {
                Authorization: `Bearer ${loadApiKey({
                    apiKey: options.apiKey,
                    environmentVariableName: 'VENICE_API_KEY',
                    description: 'Venice Provider API key',
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

    const createChatModel = (modelId: string) =>
        new VeniceChatLanguageModel(modelId, {
            ...getCommonModelConfig('chat'),
            includeUsage: options.includeUsage,
            supportsStructuredOutputs: options.supportsStructuredOutputs,
        });

    const createLanguageModel = (modelId: string) => createChatModel(modelId);
    const createCompletionModel = (modelId: string) => new OpenAICompatibleCompletionLanguageModel(modelId, { ...getCommonModelConfig('completion'), includeUsage: options.includeUsage });
    const createImageModel = (modelId: string) => new OpenAICompatibleImageModel(modelId, getCommonModelConfig('image'));
    const createEmbeddingModel = (modelId: string) => new OpenAICompatibleEmbeddingModel(modelId, getCommonModelConfig('embedding'));

    const provider = (modelId: string) => createLanguageModel(modelId);
    provider.specificationVersion = 'v2' as const;
    provider.chatModel = createChatModel;

    provider.languageModel = createLanguageModel;
    provider.imageModel = createImageModel;
    provider.embeddingModel = createEmbeddingModel;
    provider.completionModel = createCompletionModel;

    // V2
    provider.textEmbeddingModel = provider.embeddingModel;

    return provider as VeniceProvider;
}

export const venice = createVenice();
