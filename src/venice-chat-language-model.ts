import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { postJsonToApi } from "@ai-sdk/provider-utils";

export interface VeniceChatConfig {
    provider: string;
    baseURL: string;
    headers: () => Record<string, string>;
    fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

export interface VeniceChatSettings {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
}

export class VeniceChatLanguageModel implements LanguageModelV3 {
    readonly specificationVersion = "V3";
    readonly provider: string;
    readonly modelId: string;

    constructor(
        modelId: string,
        private settings: VeniceChatSettings = {},
        private config: VeniceChatConfig
    ) {
        this.provider = config.provider;
        this.modelId = modelId;
    }

    private getArgs(options: LanguageModelV3CallOptions) {
        const messages = options.prompt.map((message) => ({
            role: message.role,
            content: message.content.length === 1 && message.content[0].type === "text" ? message.content[0].text : message.content,
        }));

        return {
            model: this.modelId,
            messages,
            temperature: options.temperature ?? this.settings.temperature,
            max_tokens: options.maxOutputTokens ?? this.settings.maxTokens,
            top_p: this.settings.topP,
        };
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
