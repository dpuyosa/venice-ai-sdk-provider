import { z } from "zod/v4";

export type VeniceChatModelId = string;

export const veniceLanguageModelOptions = z.object({
  /**
   * Venice-specific parameters for advanced model features.
   */
  veniceParameters: z
    .object({
      /**
       * Enable real-time web search. Options: 'off', 'on', 'auto'.
       *
       * @default 'off'
       */
      enableWebSearch: z.enum(["off", "on", "auto"]).optional(),

      /**
       * Enable scraping URLs detected in user message.
       */
      enableWebScraping: z.boolean().optional(),

      /**
       * Include citations in web search results.
       */
      enableWebCitations: z.boolean().optional(),

      /**
       * Hide reasoning steps from response.
       */
      stripThinkingResponse: z.boolean().optional(),

      /**
       * Disable reasoning mode entirely.
       */
      disableThinking: z.boolean().optional(),

      /**
       * Include Venice system prompts.
       *
       * @default false
       */
      includeVeniceSystemPrompt: z.boolean().optional(),

      /**
       * Use a specific AI character by slug.
       */
      characterSlug: z.string().optional(),

      /**
       * Include search results in the streaming response.
       */
      includeSearchResultsInStream: z.boolean().optional(),

      /**
       * Return search results as documents.
       */
      returnSearchResultsAsDocuments: z.boolean().optional(),
    })
    .optional(),

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far.
   *
   * @default 0
   */
  frequencyPenalty: z.number().optional(),

  /**
   * Whether to include log probabilities in the response.
   */
  logprobs: z.boolean().optional(),

  /**
   * The number of highest probability tokens to return for each token position.
   */
  topLogprobs: z.number().int().optional(),

  /**
   * An upper bound for the number of tokens that can be generated for a completion.
   */
  maxCompletionTokens: z.number().int().optional(),

  /**
   * Maximum temperature value for dynamic temperature scaling.
   */
  maxTemp: z.number().min(0).max(2).optional(),

  /**
   * The maximum number of tokens that can be generated in the chat completion. Deprecated in favor of maxCompletionTokens.
   */
  maxTokens: z.number().int().optional(),

  /**
   * Sets a minimum probability threshold for token selection.
   */
  minP: z.number().min(0).max(1).optional(),

  /**
   * Minimum temperature value for dynamic temperature scaling.
   */
  minTemp: z.number().min(0).max(2).optional(),

  /**
   * How many chat completion choices to generate for each input message.
   *
   * @default 1
   */
  n: z.number().int().optional(),

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far.
   *
   * @default 0
   */
  presencePenalty: z.number().min(-2).max(2).optional(),

  /**
   * When supplied, this field may be used to optimize conversation routing to improve cache performance.
   */
  promptCacheKey: z.string().optional(),

  /**
   * The parameter for repetition penalty.
   */
  repetitionPenalty: z.number().min(0).optional(),

  /**
   * OpenAI-compatible parameter to control reasoning effort level for supported models.
   */
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),

  /**
   * The random seed used to generate the response.
   */
  seed: z.number().int().positive().optional(),

  /**
   * Up to 4 sequences where the API will stop generating further tokens.
   */
  stop: z.union([z.string(), z.array(z.string())]).optional(),

  /**
   * Array of token IDs where the API will stop generating further tokens.
   */
  stopTokenIds: z.array(z.number()).optional(),

  /**
   * Whether to stream back partial progress.
   *
   * @default false
   */
  stream: z.boolean().optional(),

  /**
   * Options for streaming.
   */
  streamOptions: z
    .object({
      includeUsage: z.boolean().optional(),
    })
    .optional(),

  /**
   * What sampling temperature to use, between 0 and 2.
   *
   */
  temperature: z.number().min(0).max(2).optional(),

  /**
   * The number of highest probability vocabulary tokens to keep for top-k-filtering.
   */
  topK: z.number().int().min(0).optional(),

  /**
   * An alternative to sampling with temperature, called nucleus sampling.
   *
   */
  topP: z.number().min(0).max(1).optional(),

  /**
   * This field is discarded on the request but is supported for compatibility.
   */
  user: z.string().optional(),

  /**
   * Format in which the response should be returned.
   */
  responseFormat: z
    .union([
      z.object({
        type: z.literal("json_object"),
      }),
      z.object({
        type: z.literal("json_schema"),
        json_schema: z.object({
          properties: z.record(z.string(), z.any()).optional(),
          required: z.array(z.string()).optional(),
          type: z.string().optional(),
        }),
      }),
    ])
    .optional(),

  /**
   * Controls which tool is called by the model.
   */
  toolChoice: z
    .union([
      z.literal("none"),
      z.literal("auto"),
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
        }),
      }),
    ])
    .optional(),

  /**
   * A list of tools the model may call.
   */
  tools: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.any().optional(),
          strict: z.boolean().optional(),
        }),
      })
    )
    .optional(),

  /**
   * Whether to use structured outputs.
   *
   * @default true
   */
  structuredOutputs: z.boolean().optional(),

  /**
   * Whether to enable parallel function calling during tool use.
   * When set to false, the model will use at most one tool per response.
   *
   * @default true
   */
  parallelToolCalls: z.boolean().optional(),
});

export type VeniceLanguageModelOptions = z.infer<typeof veniceLanguageModelOptions>;
