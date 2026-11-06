import { OpenAICompatibleEmbeddingModel, OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible';
import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, ProviderV4 } from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { loadApiKey, withoutTrailingSlash, withUserAgentSuffix } from '@ai-sdk/provider-utils';
import type { VeniceChatConfig } from './venice-chat-language-model';
import { VeniceChatLanguageModel } from './venice-chat-language-model';
import type { MetadataExtractor } from './venice-metadata-extractor';
import { createVeniceMetadataExtractor } from './venice-metadata-extractor';
import { VERSION } from './version';

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

    /**
     * Supported URLs for chat models.
     */
    supportedUrls?: VeniceChatConfig['supportedUrls'];

    /**
     * Metadata extractor for chat models. Defaults to the Venice metadata extractor.
     */
    metadataExtractor?: MetadataExtractor;

    /**
     * Transforms the request body before it is sent to the API.
     */
    transformRequestBody?: VeniceChatConfig['transformRequestBody'];

    /**
     * Custom usage converter for chat models.
     */
    convertUsage?: VeniceChatConfig['convertUsage'];
}

export interface VeniceProvider extends ProviderV4 {
    (modelId: string): VeniceChatLanguageModel;
    languageModel(modelId: string, config?: Partial<VeniceChatConfig>): VeniceChatLanguageModel;
    chatModel(modelId: string, config?: Partial<VeniceChatConfig>): VeniceChatLanguageModel;
    /**
     * Venice does not implement the legacy `/completions` endpoint.
     *
     * @throws {UnsupportedFunctionalityError} Always.
     */
    completionModel(modelId: string): LanguageModelV4;
    imageModel(modelId: string): ImageModelV4;
    embeddingModel(modelId: string): EmbeddingModelV4;

    /** @deprecated Use `embeddingModel` instead. */
    textEmbeddingModel(modelId: string): EmbeddingModelV4;
}

export function createVenice(options: VeniceProviderSettings = {}): VeniceProvider {
    const baseURL = withoutTrailingSlash(options.baseURL ?? 'https://api.venice.ai/api/v1') as string;
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

    const getModelConfig = (modelType: string) => ({
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

    const createChatModel = (modelId: string, config: Partial<VeniceChatConfig> = {}) =>
        new VeniceChatLanguageModel(modelId, {
            ...getModelConfig('chat'),
            includeUsage: options.includeUsage,
            supportsStructuredOutputs: options.supportsStructuredOutputs,
            supportedUrls: options.supportedUrls,
            metadataExtractor: options.metadataExtractor ?? createVeniceMetadataExtractor(providerName),
            transformRequestBody: options.transformRequestBody,
            convertUsage: options.convertUsage,
            ...config,
        });

    const provider = (modelId: string) => createChatModel(modelId);
    provider.specificationVersion = 'v4' as const;
    provider.chatModel = createChatModel;
    provider.languageModel = createChatModel;

    provider.completionModel = () => {
        throw new UnsupportedFunctionalityError({
            functionality: 'completionModel',
            message: "Venice does not implement the legacy '/completions' endpoint. Use 'chatModel' or 'languageModel' instead.",
        });
    };
    provider.imageModel = (modelId: string) => new OpenAICompatibleImageModel(modelId, getModelConfig('image'));
    provider.embeddingModel = (modelId: string) => new OpenAICompatibleEmbeddingModel(modelId, getModelConfig('embedding'));
    provider.textEmbeddingModel = (modelId: string) => new OpenAICompatibleEmbeddingModel(modelId, getModelConfig('embedding'));

    return provider as VeniceProvider;
}

export const venice = createVenice();
