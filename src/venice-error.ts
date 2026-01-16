import type { OpenAICompatibleErrorData, ProviderErrorStructure } from "@ai-sdk/openai-compatible";
import z from "zod/v4";

export const veniceErrorDataSchema = z.object({
    error: z.object({
        message: z.string(),
        type: z.string().nullish(),
        param: z.any().nullish(),
        code: z.union([z.string(), z.number()]).nullish(),
    }),
});

export const defaultVeniceErrorStructure: ProviderErrorStructure<OpenAICompatibleErrorData> = {
    errorSchema: veniceErrorDataSchema,
    errorToMessage: (data) => data.error.message,
};
