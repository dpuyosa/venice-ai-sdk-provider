import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";

import { loadApiKey, withoutTrailingSlash, withUserAgentSuffix } from "@ai-sdk/provider-utils";
import { VeniceChatLanguageModel } from "./venice-chat-language-model";
import { VERSION } from "./version";

export interface VeniceProvider extends Omit<ProviderV3, "imageModel" | "embeddingModel"> {
  (modelId: string): LanguageModelV3;

  languageModel(modelId: string): LanguageModelV3;
  chatModel(modelId: string): LanguageModelV3;
}

export interface VeniceProviderSettings {
  /**
   * The default prefix is `https://api.venice.ai/v1`.
   */
  baseURL: string;

  /**
   * It defaults to the `VENICE_API_KEY` environment variable.
   */
  apiKey: string;

  headers?: Record<string, string>;
  fetch?: FetchFunction;

  /**
   * Default: `true`
   */
  includeUsage?: boolean;
}

export function createVenice(settings: VeniceProviderSettings): VeniceProvider {
  const baseURL = withoutTrailingSlash(settings.baseURL) ?? "https://api.venice.ai/v1";

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: settings.apiKey,
          environmentVariableName: "VENICE_API_KEY",
          description: "Venice",
        })}`,
        ...settings.headers,
      },
      `ai-sdk/venice/${VERSION}`
    );

  const createChatModel = (modelId: string) =>
    new VeniceChatLanguageModel(modelId, {
      provider: "venice.chat",
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: settings.fetch,
      includeUsage: settings.includeUsage,
    });

  const provider = (modelId: string) => createChatModel(modelId);
  provider.specificationVersion = "v3" as const;
  provider.languageModel = createChatModel;
  provider.chatModel = createChatModel;

  return provider;
}
