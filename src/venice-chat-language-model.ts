import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { combineHeaders, createEventSourceResponseHandler, createJsonResponseHandler, generateId, isParsableJson, parseProviderOptions, postJsonToApi } from "@ai-sdk/provider-utils";
import type { ParseResult } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
import type { VeniceChatModelId } from "./venice-chat-options";
import { veniceLanguageModelOptions } from "./venice-chat-options";
import { convertToVeniceChatMessages } from "./convert-to-venice-chat-messages";

export type VeniceChatConfig = {
  provider: string;
  headers: () => Record<string, string | undefined>;
  url: (options: { modelId: string; path: string }) => string;
  fetch?: FetchFunction;
  includeUsage?: boolean;
  supportedUrls?: () => LanguageModelV3["supportedUrls"];
};

interface VeniceUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  prompt_tokens_details?: {
    cached_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
}

const veniceChatResponseSchema = z.looseObject({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant").nullish(),
        content: z.string().nullish(),
        reasoning_content: z.string().nullish(),
        reasoning: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              id: z.string().nullish(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            })
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().nullish(),
          cache_creation_input_tokens: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

const chunkBaseSchema = z.looseObject({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      delta: z
        .object({
          role: z.enum(["assistant"]).nullish(),
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          reasoning: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().nullish(),
                id: z.string().nullish(),
                function: z.object({
                  name: z.string().nullish(),
                  arguments: z.string().nullish(),
                }),
              })
            )
            .nullish(),
        })
        .nullish(),
      finish_reason: z.string().nullish(),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().nullish(),
          cache_creation_input_tokens: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

const veniceChatChunkSchema = z.union([chunkBaseSchema, z.object({ error: z.object({ message: z.string() }) })]);

type VeniceChunk = z.infer<typeof veniceChatChunkSchema>;

const defaultVeniceFailedResponseHandler = async ({ response, errorData }: { response: Response; errorData?: Record<string, unknown> }) => {
  const errorMessage = (errorData as { error?: { message?: string } })?.error?.message;
  const directMessage = (errorData as { message?: string })?.message;
  const message = errorMessage ?? directMessage ?? response.statusText ?? "Unknown error";

  throw new Error(`Venice API error: ${message}`);
};

function mapVeniceFinishReason(finishReason: string | null | undefined): LanguageModelV3FinishReason {
  switch (finishReason) {
    case "stop":
      return { unified: "stop", raw: finishReason };
    case "length":
      return { unified: "length", raw: finishReason };
    case "tool_calls":
      return { unified: "tool-calls", raw: finishReason };
    case "content_filter":
      return { unified: "content-filter", raw: finishReason };
    case null:
    case undefined:
      return { unified: "other", raw: undefined };
    default:
      return { unified: "other", raw: finishReason };
  }
}

function convertVeniceUsage(usage: VeniceUsage | null | undefined): LanguageModelV3Usage {
  if (!usage) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    };
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens = usage.prompt_tokens_details?.cache_creation_input_tokens ?? 0;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cacheReadTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens,
      reasoning: undefined,
    },
    raw: usage as unknown as LanguageModelV3Usage["raw"],
  };
}

function getResponseMetadata(response: { id?: string | null | undefined; created?: number | null | undefined; model?: string | null | undefined }) {
  return {
    id: response.id ?? generateId(),
    timestamp: response.created ? new Date(response.created * 1000) : new Date(),
    modelId: response.model ?? "unknown",
  };
}

export class VeniceChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;

  readonly modelId: VeniceChatModelId;
  private readonly config: VeniceChatConfig;
  private readonly chunkSchema: z.ZodType;

  constructor(modelId: VeniceChatModelId, config: VeniceChatConfig) {
    this.modelId = modelId;
    this.config = config;
    this.chunkSchema = veniceChatChunkSchema;
  }

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls() {
    return this.config.supportedUrls?.() ?? {};
  }

  private async getArgs({ prompt, maxOutputTokens, temperature, topP, topK, frequencyPenalty, presencePenalty, stopSequences, responseFormat, seed, toolChoice, tools }: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const veniceOptions =
      (await parseProviderOptions({
        provider: "venice",
        providerOptions: {},
        schema: veniceLanguageModelOptions,
      })) ?? {};

    if (topK != null) {
      warnings.push({ type: "unsupported", feature: "topK" });
    }

    const {
      tools: mappedTools,
      toolChoice: mappedToolChoice,
      toolWarnings,
    } = this.prepareTools({
      tools: tools?.filter((t): t is Extract<typeof t, { type: "function" }> => t.type === "function") as
        | Array<{
            type: "function";
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>
        | undefined,
      toolChoice,
    });

    const veniceParameters = veniceOptions.veniceParameters;

    return {
      args: {
        model: this.modelId,

        user: veniceOptions.user,

        max_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        response_format:
          responseFormat?.type === "json"
            ? responseFormat.schema != null
              ? {
                  type: "json_schema",
                  json_schema: {
                    schema: responseFormat.schema,
                    strict: veniceOptions.structuredOutputs ?? true,
                    name: responseFormat.name ?? "response",
                    description: responseFormat.description,
                  },
                }
              : { type: "json_object" }
            : undefined,

        stop: stopSequences,
        seed,

        reasoning_effort: veniceOptions.reasoningEffort,

        messages: convertToVeniceChatMessages(prompt),

        tools: mappedTools,
        tool_choice: mappedToolChoice,

        ...(veniceParameters ? { venice_parameters: veniceParameters } : {}),
      },
      warnings: [...warnings, ...toolWarnings],
    };
  }

  // Type assertion for Venice function tool
  private toVeniceFunctionTool(tool: { type: "function"; name: string; description?: string; inputSchema?: Record<string, unknown> }): {
    type: "function";
    function: { name: string; description?: string; parameters: unknown };
  } {
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as unknown,
      },
    };
  }

  private prepareTools({
    tools,
    toolChoice,
  }: {
    tools?: Array<{
      type: "function";
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
    toolChoice?: {
      type: "auto" | "none" | "required" | "tool" | "function";
      name?: string;
    };
  }) {
    const warnings: SharedV3Warning[] = [];

    if (tools != null && tools.some((t) => t.type !== "function")) {
      warnings.push({
        type: "unsupported",
        feature: "non-function tools",
      });
    }

    const functionTools = tools?.map((tool) => this.toVeniceFunctionTool(tool));

    let mappedToolChoice: { type: "function"; function: { name: string } } | { type: "auto" } | { type: "none" } | undefined;

    if (toolChoice != null) {
      if (toolChoice.type === "function" && toolChoice.name != null) {
        mappedToolChoice = {
          type: "function",
          function: { name: toolChoice.name },
        };
      } else if (toolChoice.type === "auto" || toolChoice.type === "none") {
        mappedToolChoice = { type: toolChoice.type };
      } else if (toolChoice.type === "function" && toolChoice.name == null) {
        warnings.push({
          type: "unsupported",
          feature: "toolChoice function without name",
        });
      } else {
        warnings.push({
          type: "unsupported",
          feature: `toolChoice type: ${toolChoice.type}`,
        });
      }
    }

    return {
      tools: functionTools,
      toolChoice: mappedToolChoice,
      toolWarnings: warnings,
    };
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { args, warnings } = await this.getArgs({ ...options });

    const {
      responseHeaders,
      value: responseBody,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: defaultVeniceFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(veniceChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = responseBody.choices[0];
    const content: Array<LanguageModelV3Content> = [];

    if (choice?.message?.content != null && choice.message.content.length > 0) {
      content.push({ type: "text", text: choice.message.content });
    }

    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
    if (reasoning != null && reasoning.length > 0) {
      content.push({
        type: "reasoning",
        text: reasoning,
      });
    }

    if (choice?.message?.tool_calls != null) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: toolCall.id ?? generateId(),
          toolName: toolCall.function.name,
          input: toolCall.function.arguments!,
        });
      }
    }

    return {
      content,
      finishReason: mapVeniceFinishReason(choice?.finish_reason ?? undefined),
      usage: convertVeniceUsage(responseBody.usage ?? null),
      request: { body: args },
      response: {
        ...getResponseMetadata(responseBody),
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { args, warnings } = await this.getArgs({ ...options });

    const body = {
      ...args,
      stream: true,
      stream_options: this.config.includeUsage ? { include_usage: true } : undefined,
    };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: defaultVeniceFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(this.chunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const toolCalls: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
      hasFinished: boolean;
    }> = [];

    let finishReason: LanguageModelV3FinishReason = {
      unified: "other",
      raw: undefined,
    };
    let usage: VeniceUsage | undefined = undefined;
    let isFirstChunk = true;
    let isActiveReasoning = false;
    let isActiveText = false;

    return {
      stream: response.pipeThrough(
        new TransformStream<ParseResult<VeniceChunk>, LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },

          transform(chunk, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }

            if (!chunk.success) {
              finishReason = { unified: "error", raw: undefined };
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }

            const value = chunk.value as VeniceChunk;

            if ("error" in value) {
              finishReason = { unified: "error", raw: undefined };
              controller.enqueue({
                type: "error",
                error: (value as { error?: { message?: string } }).error?.message ?? "Unknown error",
              });
              return;
            }

            const chunkData = value as z.infer<typeof chunkBaseSchema>;

            if (isFirstChunk) {
              isFirstChunk = false;

              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata(chunkData),
              });
            }

            if (chunkData.usage != null) {
              usage = chunkData.usage as VeniceUsage;
            }

            const choice = chunkData.choices[0];

            if (choice?.finish_reason != null) {
              finishReason = mapVeniceFinishReason(choice.finish_reason);
            }

            if (choice?.delta == null) {
              return;
            }

            const delta = choice.delta;

            const reasoningContent = delta.reasoning_content ?? delta.reasoning;
            if (reasoningContent) {
              if (!isActiveReasoning) {
                controller.enqueue({
                  type: "reasoning-start",
                  id: "reasoning-0",
                });
                isActiveReasoning = true;
              }

              controller.enqueue({
                type: "reasoning-delta",
                id: "reasoning-0",
                delta: reasoningContent,
              });
            }

            if (delta.content) {
              if (isActiveReasoning) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: "reasoning-0",
                });
                isActiveReasoning = false;
              }

              if (!isActiveText) {
                controller.enqueue({ type: "text-start", id: "txt-0" });
                isActiveText = true;
              }

              controller.enqueue({
                type: "text-delta",
                id: "txt-0",
                delta: delta.content,
              });
            }

            if (delta.tool_calls != null) {
              if (isActiveReasoning) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: "reasoning-0",
                });
                isActiveReasoning = false;
              }

              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index ?? toolCalls.length;

                if (toolCalls[index] == null) {
                  if (toolCallDelta.id == null) {
                    throw new Error(`Expected 'id' to be a string.`);
                  }

                  if (toolCallDelta.function?.name == null) {
                    throw new Error(`Expected 'function.name' to be a string.`);
                  }

                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallDelta.id,
                    toolName: toolCallDelta.function.name,
                  });

                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    type: "function",
                    function: {
                      name: toolCallDelta.function.name,
                      arguments: toolCallDelta.function.arguments ?? "",
                    },
                    hasFinished: false,
                  };

                  const toolCall = toolCalls[index];

                  if (toolCall.function?.name != null && toolCall.function?.arguments != null) {
                    if (toolCall.function.arguments.length > 0) {
                      controller.enqueue({
                        type: "tool-input-delta",
                        id: toolCall.id,
                        delta: toolCall.function.arguments,
                      });
                    }

                    if (isParsableJson(toolCall.function.arguments)) {
                      controller.enqueue({
                        type: "tool-input-end",
                        id: toolCall.id,
                      });

                      controller.enqueue({
                        type: "tool-call",
                        toolCallId: toolCall.id ?? generateId(),
                        toolName: toolCall.function.name,
                        input: toolCall.function.arguments,
                      });
                      toolCall.hasFinished = true;
                    }
                  }

                  continue;
                }

                const toolCall = toolCalls[index];

                if (toolCall.hasFinished) {
                  continue;
                }

                if (toolCallDelta.function?.arguments != null) {
                  toolCall.function.arguments += toolCallDelta.function?.arguments ?? "";
                }

                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.id,
                  delta: toolCallDelta.function.arguments ?? "",
                });

                if (toolCall.function?.name != null && toolCall.function?.arguments != null && isParsableJson(toolCall.function.arguments)) {
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCall.id,
                  });

                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments,
                  });
                  toolCall.hasFinished = true;
                }
              }
            }
          },

          flush(controller) {
            if (isActiveReasoning) {
              controller.enqueue({ type: "reasoning-end", id: "reasoning-0" });
            }

            if (isActiveText) {
              controller.enqueue({ type: "text-end", id: "txt-0" });
            }

            for (const toolCall of toolCalls.filter((toolCall) => !toolCall.hasFinished)) {
              controller.enqueue({
                type: "tool-input-end",
                id: toolCall.id,
              });

              controller.enqueue({
                type: "tool-call",
                toolCallId: toolCall.id ?? generateId(),
                toolName: toolCall.function.name,
                input: toolCall.function.arguments,
              });
            }

            controller.enqueue({
              type: "finish",
              finishReason,
              usage: convertVeniceUsage(usage ?? null),
            });
          },
        })
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}
