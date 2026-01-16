import type { MetadataExtractor, ProviderErrorStructure } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { parseProviderOptions, postJsonToApi, type FetchFunction } from "@ai-sdk/provider-utils";
import { veniceLanguageModelOptions } from "./venice-chat-options";
import { prepareTools } from "./venice-prepare-tools";

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


    constructor(
        modelId: string,
        config: VeniceChatConfig
    ) {
        this.modelId = modelId;
        this.config = config;
    }

    // TODO: Add error handling?

    get provider(): string {
        return this.config.provider ?? "venice";
    }

    get supportedUrls() {
        return this.config.supportedUrls?.() ?? {
            "image/*": [/^data:image\/(?:jpeg|png|webp);base64,/, /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i],
        };
    }

    private async getArgs(options: LanguageModelV3CallOptions) {
        const compatibleOptions = Object.assign(
            (await parseProviderOptions({
                provider: this.provider,
                providerOptions: options.providerOptions,
                schema: veniceLanguageModelOptions,
            })) ?? {},
            (await parseProviderOptions({
                provider: 'openai-compatible',
                providerOptions: options.providerOptions,
                schema: veniceLanguageModelOptions,
            })) ?? {},
        );

        const {
            tools: openaiTools,
            toolChoice: openaiToolChoice,
            toolWarnings,
        } = prepareTools({
            tools: options.tools,
            toolChoice: options.toolChoice,
        });


        return {
            args: {

            }
        }
    }

    async doGenerate(options: LanguageModelV3CallOptions) {
        const body = this.getArgs(options);

        const response = await postJsonToApi({
            url: `${this.config.baseURL}/chat/completions`,
            headers: this.config.headers(),
            body,
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
