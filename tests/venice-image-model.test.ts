import type { ImageModelV4CallOptions } from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { VeniceImageModel } from '../src/venice-image-model';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

function createFetch(response: () => Response) {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return response();
    }) as FetchFunction;
    return { fetch, requests };
}

function createModel(response: () => Response) {
    const { fetch, requests } = createFetch(response);
    const model = new VeniceImageModel('image-model', {
        provider: 'venice.image',
        url: ({ path }) => `https://api.test/v1${path}`,
        headers: () => ({}),
        fetch,
    });
    return { model, requests };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function binaryResponse(): Response {
    return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
}

const dataFile = { type: 'file' as const, mediaType: 'image/png', data: PNG_BYTES };

function callOptions(overrides: Partial<ImageModelV4CallOptions> = {}): ImageModelV4CallOptions {
    return {
        prompt: 'x',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerOptions: {},
        ...overrides,
    };
}

describe('VeniceImageModel generation', () => {
    it('posts to /image/generate with variants, aspect ratio, seed, and mapped provider options', async () => {
        const { model, requests } = createModel(() => jsonResponse({ images: [PNG_BASE64, PNG_BASE64] }));

        const result = await model.doGenerate(
            callOptions({
                prompt: 'a canal',
                n: 2,
                aspectRatio: '16:9',
                seed: 42,
                providerOptions: {
                    venice: { format: 'jpeg', background: 'transparent', moderation: 'low', resolution: '2K', negative_prompt: 'blurry' },
                },
            })
        );

        expect(requests[0]?.url).toBe('https://api.test/v1/image/generate');
        expect(requests[0]?.body).toEqual({
            model: 'image-model',
            prompt: 'a canal',
            variants: 2,
            return_binary: false,
            aspect_ratio: '16:9',
            seed: 42,
            format: 'png',
            transparent_background: true,
            safe_mode: false,
            resolution: '2K',
            negative_prompt: 'blurry',
        });
        expect(result.images).toEqual([PNG_BASE64, PNG_BASE64]);
        expect(result.warnings).toEqual([]);
        expect(model.maxImagesPerCall).toBe(4);
        expect(model.supportsFileInputs).toBe(true);
        expect(model.supportsMaskInputs).toBe(false);
    });

    it('maps size to width and height and errors above 1280px', async () => {
        const { model, requests } = createModel(() => jsonResponse({ images: [PNG_BASE64] }));

        await model.doGenerate(callOptions({ size: '1280x720' }));
        expect(requests[0]?.body.width).toBe(1280);
        expect(requests[0]?.body.height).toBe(720);

        await expect(model.doGenerate(callOptions({ size: '1920x1080' }))).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    });

    it('keeps background transparency unless transparent_background is explicitly set', async () => {
        const { model, requests } = createModel(() => jsonResponse({ images: [PNG_BASE64] }));

        await model.doGenerate(callOptions({ providerOptions: { venice: { background: 'transparent' } } }));
        expect(requests[0]?.body.transparent_background).toBe(true);

        await model.doGenerate(callOptions({ providerOptions: { venice: { background: 'transparent', transparent_background: false } } }));
        expect(requests[1]?.body.transparent_background).toBe(false);
    });

    it('forces png when transparency is enabled with jpeg output', async () => {
        const { model, requests } = createModel(() => jsonResponse({ images: [PNG_BASE64] }));

        const result = await model.doGenerate(callOptions({ providerOptions: { venice: { format: 'jpeg', transparent_background: true } } }));

        expect(requests[0]?.body).toMatchObject({ format: 'png', transparent_background: true });
        expect(result.warnings).toEqual([]);
    });

    it('marks empty results retryable and warns when fewer images are returned', async () => {
        const empty = createModel(() => jsonResponse({ images: [] }));
        const emptyResult = await empty.model.doGenerate(callOptions({ n: 2 }));
        expect(emptyResult.images).toEqual([]);
        expect(emptyResult.isRetryable).toBe(true);

        const partial = createModel(() => jsonResponse({ images: [PNG_BASE64] }));
        const partialResult = await partial.model.doGenerate(callOptions({ n: 2 }));
        expect(partialResult.warnings).toEqual([{ type: 'other', message: 'Venice returned 1 image(s) but 2 were requested.' }]);
    });
});

describe('VeniceImageModel editing', () => {
    it('posts to /image/edit with a data URI and returns binary images', async () => {
        const { model, requests } = createModel(binaryResponse);

        const result = await model.doGenerate(
            callOptions({
                prompt: 'make it night',
                aspectRatio: '1:1',
                seed: 5,
                files: [dataFile],
                providerOptions: { venice: { resolution: '1K', output_format: 'png', moderation: 'low', quality: 'high' } },
            })
        );

        expect(requests[0]?.url).toBe('https://api.test/v1/image/edit');
        expect(requests[0]?.body).toEqual({
            model: 'image-model',
            prompt: 'make it night',
            image: 'data:image/png;base64,iVBORw==',
            aspect_ratio: '1:1',
            resolution: '1K',
            output_format: 'png',
            safe_mode: false,
        });
        expect(result.images).toEqual([PNG_BYTES]);
        expect(result.warnings).toEqual([
            { type: 'unsupported', feature: 'seed', details: "Venice '/image/edit' does not accept a seed." },
            { type: 'unsupported', feature: 'quality', details: "Venice '/image/edit' does not support the 'quality' provider option." },
        ]);
    });

    it('forces png for transparency and warns about ignored options', async () => {
        const { model, requests } = createModel(binaryResponse);

        const result = await model.doGenerate(
            callOptions({
                size: '1024x1024',
                seed: 5,
                files: [dataFile],
                providerOptions: { venice: { output_format: 'jpeg', background: 'transparent', style: 'anime' } },
            })
        );

        expect(requests[0]?.body).toMatchObject({ output_format: 'png', transparent_background: true });
        expect(result.warnings).toEqual([
            { type: 'unsupported', feature: 'size', details: "Venice '/image/edit' does not accept size; use aspectRatio and the 'resolution' provider option." },
            { type: 'unsupported', feature: 'seed', details: "Venice '/image/edit' does not accept a seed." },
            { type: 'unsupported', feature: 'style', details: "Venice image models do not support the 'style' provider option." },
        ]);
    });

    it('issues one request per image when n > 1', async () => {
        const { model, requests } = createModel(binaryResponse);

        const result = await model.doGenerate(callOptions({ prompt: 'variations', n: 3, files: [dataFile] }));

        expect(requests).toHaveLength(3);
        expect(result.images).toEqual([PNG_BYTES, PNG_BYTES, PNG_BYTES]);
    });

    it('rejects masks and multiple input files', async () => {
        const { model } = createModel(binaryResponse);

        await expect(model.doGenerate(callOptions({ files: [dataFile], mask: dataFile }))).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
        await expect(model.doGenerate(callOptions({ files: [dataFile, dataFile] }))).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    });
});
