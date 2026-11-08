import type { FetchFunction } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { VeniceSpeechModel } from '../src/venice-speech-model';

function createFetch(response: () => Response) {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), body: init?.body });
        return response();
    }) as FetchFunction;
    return { fetch, requests };
}

function createModel(response: () => Response) {
    const { fetch, requests } = createFetch(response);
    const model = new VeniceSpeechModel('tts-model', {
        provider: 'venice.speech',
        url: ({ path }) => `https://api.test/v1${path}`,
        headers: () => ({ authorization: 'Bearer test' }),
        fetch,
    });
    return { model, requests };
}

function audioResponse(): Response {
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}

describe('VeniceSpeechModel', () => {
    it('posts to /audio/speech and returns binary audio', async () => {
        const { model, requests } = createModel(audioResponse);

        const result = await model.doGenerate({
            text: 'hello there',
            voice: 'af_sky',
            outputFormat: 'mpeg',
            speed: 1.1,
            language: 'en',
            instructions: 'Speak softly',
            providerOptions: { venice: { temperature: 0.5, topP: 0.9 } },
        });

        expect(requests[0]?.url).toBe('https://api.test/v1/audio/speech');
        expect(JSON.parse(String(requests[0]?.body))).toEqual({
            model: 'tts-model',
            input: 'hello there',
            response_format: 'mp3',
            voice: 'af_sky',
            speed: 1.1,
            language: 'en',
            prompt: 'Speak softly',
            temperature: 0.5,
            top_p: 0.9,
        });
        expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
        expect(result.warnings).toEqual([]);
        expect(result.response.modelId).toBe('tts-model');
        expect(result.request?.body).toBe(JSON.stringify(JSON.parse(String(requests[0]?.body))));
    });

    it('normalizes wav and defaults to mp3 for unsupported formats', async () => {
        const { model, requests } = createModel(audioResponse);

        const wav = await model.doGenerate({ text: 'hi', outputFormat: 'wave' });
        expect(JSON.parse(String(requests[0]?.body)).response_format).toBe('wav');

        const unsupported = await model.doGenerate({ text: 'hi', outputFormat: 'ogg' });
        expect(JSON.parse(String(requests[1]?.body)).response_format).toBe('mp3');
        expect(unsupported.warnings).toEqual([
            { type: 'unsupported', feature: 'outputFormat', details: 'Unsupported output format: ogg. Using mp3 instead.' },
        ]);
        expect(wav.warnings).toEqual([]);
    });

    it('warns and omits streaming and truncates long instructions', async () => {
        const { model, requests } = createModel(audioResponse);

        const result = await model.doGenerate({
            text: 'hi',
            instructions: 'a'.repeat(501),
            providerOptions: { venice: { streaming: true } },
        });

        const body = JSON.parse(String(requests[0]?.body));
        expect(body.prompt).toHaveLength(500);
        expect(body.streaming).toBeUndefined();
        expect(result.warnings).toEqual([
            { type: 'unsupported', feature: 'streaming', details: 'Venice speech synthesis streaming is not supported by SpeechModelV4; the option was ignored.' },
            { type: 'other', message: 'Venice speech instructions are limited to 500 characters; the value was truncated.' },
        ]);
    });
});
