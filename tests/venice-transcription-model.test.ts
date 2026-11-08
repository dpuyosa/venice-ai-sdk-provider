import type { FetchFunction } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { VeniceTranscriptionModel } from '../src/venice-transcription-model';

function createFetch(response: () => Response) {
    const requests: Array<{ url: string; formData: FormData }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), formData: init?.body as FormData });
        return response();
    }) as FetchFunction;
    return { fetch, requests };
}

function createModel(response: () => Response) {
    const { fetch, requests } = createFetch(response);
    const model = new VeniceTranscriptionModel('whisper-model', {
        provider: 'venice.transcription',
        url: ({ path }) => `https://api.test/v1${path}`,
        headers: () => ({}),
        fetch,
    });
    return { model, requests };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('VeniceTranscriptionModel', () => {
    it('posts multipart form data and maps timestamps', async () => {
        const { model, requests } = createModel(() =>
            jsonResponse({
                text: 'hello world',
                duration: 2.5,
                language: 'en',
                timestamps: {
                    word: [
                        { word: 'hello', start: 0, end: 1 },
                        { word: 'world', start: 1, end: 2 },
                    ],
                    segment: [{ text: 'hello world', start: 0, end: 2 }],
                },
            })
        );

        const result = await model.doGenerate({
            audio: new Uint8Array([1, 2, 3]),
            mediaType: 'audio/mpeg',
            timestampGranularities: ['word', 'segment'],
        });

        const formData = requests[0]?.formData;
        expect(requests[0]?.url).toBe('https://api.test/v1/audio/transcriptions');
        expect(formData?.get('model')).toBe('whisper-model');
        expect(formData?.get('response_format')).toBe('json');
        expect(formData?.get('timestamps')).toBe('true');
        const file = formData?.get('file') as File;
        expect(file.name).toBe('audio.mp3');
        expect(file.type).toBe('audio/mpeg');

        expect(result.text).toBe('hello world');
        expect(result.segments).toEqual([{ text: 'hello world', startSecond: 0, endSecond: 2 }]);
        expect(result.words).toEqual([
            { text: 'hello', startSecond: 0, endSecond: 1 },
            { text: 'world', startSecond: 1, endSecond: 2 },
        ]);
        expect(result.language).toBe('en');
        expect(result.durationInSeconds).toBe(2.5);
    });

    it('falls back to word timings for segments and reports unsupported options', async () => {
        const { model, requests } = createModel(() =>
            jsonResponse({
                text: 'hi',
                timestamps: { word: [{ word: 'hi', start: 0, end: 1 }] },
            })
        );

        const result = await model.doGenerate({
            audio: 'AQID',
            mediaType: 'audio/wav',
            providerOptions: { venice: { language: 'fr', responseFormat: 'text', prompt: 'x', temperature: 0.2 } },
        });

        expect(requests[0]?.formData.get('language')).toBe('fr');
        expect(requests[0]?.formData.get('timestamps')).toBeNull();
        expect(result.segments).toEqual([{ text: 'hi', startSecond: 0, endSecond: 1 }]);
        expect(result.language).toBe('fr');
        expect(result.warnings).toEqual([
            { type: 'unsupported', feature: 'responseFormat', details: 'Venice transcription always returns JSON; responseFormat text was ignored.' },
            { type: 'unsupported', feature: 'prompt', details: 'Venice transcription does not accept a prompt.' },
            { type: 'unsupported', feature: 'temperature', details: 'Venice transcription does not accept a temperature.' },
        ]);
    });

    it('reads provider options from a custom provider key', async () => {
        const { fetch, requests } = createFetch(() => jsonResponse({ text: 'hi' }));
        const model = new VeniceTranscriptionModel('whisper-model', {
            provider: 'custom.transcription',
            url: ({ path }) => `https://api.test/v1${path}`,
            headers: () => ({}),
            fetch,
        });

        await model.doGenerate({
            audio: new Uint8Array([1]),
            mediaType: 'audio/mpeg',
            providerOptions: { custom: { timestamps: true, language: 'de' } },
        });

        expect(requests[0]?.formData.get('timestamps')).toBe('true');
        expect(requests[0]?.formData.get('language')).toBe('de');
    });
});
