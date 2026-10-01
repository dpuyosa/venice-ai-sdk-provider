import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';

import { z } from 'zod/v4';

const openAIErrorDataSchema = z.object({
    error: z.object({
        message: z.string(),
        type: z.string().nullish(),
        param: z.any().nullish(),
        code: z.union([z.string(), z.number()]).nullish(),
    }),
});

// Most Venice API errors carry the message as a plain string, with schema validation failures listed in `issues`.
const veniceStringErrorDataSchema = z.looseObject({
    error: z.string(),
    issues: z
        .array(
            z.looseObject({
                message: z.string(),
                path: z.array(z.union([z.string(), z.number()])).optional(),
            })
        )
        .optional(),
});

export const veniceErrorDataSchema = z.union([openAIErrorDataSchema, veniceStringErrorDataSchema]);

export type VeniceErrorData = z.infer<typeof veniceErrorDataSchema>;

export function getVeniceErrorMessage(data: VeniceErrorData): string {
    if (typeof data.error !== 'string') return data.error.message;

    const issues = 'issues' in data ? (data.issues ?? []) : [];
    const details = issues.map((issue) => (issue.path?.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
    return details.length > 0 ? `${data.error}: ${details.join('; ')}` : data.error;
}

export const defaultVeniceErrorStructure: ProviderErrorStructure<VeniceErrorData> = {
    errorSchema: veniceErrorDataSchema,
    errorToMessage: getVeniceErrorMessage,
};
