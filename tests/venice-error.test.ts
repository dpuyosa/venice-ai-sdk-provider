import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { defaultVeniceErrorStructure, getVeniceErrorMessage, veniceErrorDataSchema } from '../src/venice-error';

const handleError = createJsonErrorResponseHandler(defaultVeniceErrorStructure);

async function apiError(status: number, body: unknown) {
    const response = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const { value } = await handleError({ response, url: 'https://api.venice.ai/api/v1/chat/completions', requestBodyValues: {} });
    return value;
}

describe('Venice error parsing', () => {
    it('reads string errors returned by the Venice API', async () => {
        const error = await apiError(404, { error: 'Specified model not found: no-such-model. Did you mean: openai-gpt-52-codex?' });

        expect(error.message).toBe('Specified model not found: no-such-model. Did you mean: openai-gpt-52-codex?');
        expect(error.statusCode).toBe(404);
    });

    it('includes validation issues in the message', async () => {
        const error = await apiError(400, {
            details: { _errors: ["Unrecognized key(s) in object: 'foo_bar'"] },
            error: 'Invalid request parameters',
            issues: [{ code: 'unrecognized_keys', keys: ['foo_bar'], path: [], message: "Unrecognized key(s) in object: 'foo_bar'" }],
        });

        expect(error.message).toBe("Invalid request parameters: Unrecognized key(s) in object: 'foo_bar'");
    });

    it('prefixes nested issue paths', () => {
        const message = getVeniceErrorMessage({
            error: 'Invalid request parameters',
            issues: [{ path: ['messages', 1, 'content'], message: 'Required' }],
        });

        expect(message).toBe('Invalid request parameters: messages.1.content: Required');
    });

    it('still reads OpenAI-shaped errors', async () => {
        const error = await apiError(400, {
            error: { message: 'This model has a maximum context length of 8192 tokens.', type: 'invalid_request_error', param: 'messages', code: 'context_length_exceeded' },
        });

        expect(error.message).toBe('This model has a maximum context length of 8192 tokens.');
    });

    it('parses in-stream error chunks in both shapes', () => {
        expect(veniceErrorDataSchema.safeParse({ error: { message: 'The model is currently overloaded.', type: 'server_error', code: 'model_overloaded' } }).success).toBe(true);
        expect(veniceErrorDataSchema.safeParse({ error: 'The model is currently overloaded. Please try again later.' }).success).toBe(true);
    });
});
