import { embedMany, experimental_decide, generateImage, generateSpeech, generateText, isStepCount, Output, streamText, tool, transcribe } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { createVenice } from '../../src/venice-provider';

function loadDotEnv(): void {
    if (process.env.VENICE_API_KEY != null) return;
    try {
        process.loadEnvFile();
    } catch {
        // No .env file; the credential check below reports the missing key.
    }
}

loadDotEnv();

const apiKey = process.env.VENICE_API_KEY;

if (apiKey == null || apiKey.trim().length === 0) {
    throw new Error('Live Venice E2E tests require VENICE_API_KEY in the environment or in .env. Run them with `bun run test:e2e`.');
}

const provider = createVenice({ apiKey });
const baseURL = 'https://api.venice.ai/api/v1';
const chatModelId = process.env.VENICE_E2E_CHAT_MODEL ?? 'default';
const transcriptionModelId = process.env.VENICE_E2E_TRANSCRIPTION_MODEL ?? 'openai/whisper-large-v3';
const embeddingModelId = process.env.VENICE_E2E_EMBEDDING_MODEL ?? 'text-embedding-bge-m3';
const speechModelId = process.env.VENICE_E2E_SPEECH_MODEL ?? 'tts-kokoro';
const speechVoice = process.env.VENICE_E2E_SPEECH_VOICE ?? 'af_sky';
const imageGenerationModelId = process.env.VENICE_E2E_IMAGE_GENERATION_MODEL ?? 'default';
const imageEditModelId = process.env.VENICE_E2E_IMAGE_EDIT_MODEL ?? 'qwen-image-2-1-turbo-edit';
const decisionModelId = process.env.VENICE_E2E_DECISION_MODEL ?? 'jev-latest';

type VeniceTextModel = {
    id: string;
    offline?: boolean;
    model_spec?: {
        capabilities?: {
            supportsFunctionCalling?: boolean;
            supportsResponseSchema?: boolean;
            supportsWebSearch?: boolean;
        };
    };
};

let textModelsPromise: Promise<VeniceTextModel[]> | undefined;

function getTextModels(): Promise<VeniceTextModel[]> {
    textModelsPromise ??= (async () => {
        const response = await fetch(`${baseURL}/models?type=text`, {
            headers: { Authorization: `Bearer ${String(apiKey)}` },
        });
        if (!response.ok) {
            throw new Error(`Venice GET /models failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as { data?: VeniceTextModel[] };
        return payload.data ?? [];
    })();
    return textModelsPromise;
}

function pickModel(models: VeniceTextModel[], predicate: (model: VeniceTextModel) => boolean): string | undefined {
    return models.find((model) => model.offline !== true && predicate(model))?.id;
}

async function resolveTextModel(envOverride: string | undefined, predicate: (model: VeniceTextModel) => boolean): Promise<string> {
    const modelId = envOverride ?? pickModel(await getTextModels(), predicate);
    if (modelId == null) {
        throw new Error('No capable Venice text model was found via GET /models; set the corresponding VENICE_E2E_*_MODEL override.');
    }
    return modelId;
}

// 8 kHz mono 16-bit PCM WAV of a synthesized voice saying "hello world".
const SAMPLE_WAV_BASE64 =
    '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ngHHAaYBMQEMAdYAawA2ABkA6//m/9v/zv/O/9H/3P/Z/9b/9P/m/9r/8P/4/woADQAIACEAJAAyACwAMAA+ACkAFwAbACUABwD6//L/3v/c/+D/2f/d//r/5//r//P/8P8CAP7/AAAGAAYAEwAFAAMABwACAAcABAD//wkA///5//3/AQAIAAMAAAAHAAcACwAEAAgACwAEAP7/AQALAP3//P/5//b/+v/8/wYABAACAP7//v/5//z/AwADAAQABwAAAAAA/f///wAAAwAHAAQA+v8EAP////8AAAgADQAAAPv/AgALAAEACAAOAAMA//8AAPj//v8BAAcACAABAP3/+v/5//3/AQD//wEAAwD9//n/AwABAPv//v/+/wAAAwACAAAA/v8FAPv//v8IAAMACAD9//7/AAAAAAAABAAGAAcAAwABAAEA/P/7/wQABgACAAYA+f8BAAMA/v8BAAIA+/8FAAcA//8EAAIABgABAP7/AwADAAEAAgABAAAA////////+v8AAAMAAQD4//n//v8CAAQA/v/+////AAACAPj/+v///wEA//8FAP7///8BAP7/AwAAAP//AwAEAAQA+v/7/wgABAD/////AAABAPr/+v/9/wcAAAACAAQA/P8FAAEA/////wAABAD//wQA//////z/AwAMAP7////9//r/AQACAP//AQD7/wMAAwD9//7/9//6/wIACgD+/wEA/f/9/wIA+//+/wEABAAFAP3/+f/9/wYAAgABAAIABQADAPz//f/9/wYAAAAAAAEABQD8/wIAAwD/////+P8DAAsAAgD6//7/AQACAP//AgAAAP3/AwD8/wIAAgD9/wMA/f8CAP7/+/8AAAIA/v8AAAIAAAABAAMA//8AAP7/AAAAAAIABAABAPr/AwAAAAAAAAAGAAgA/f/7/wIACQAAAAYACAD+//3/AAD7/wEAAgAHAAAABAD8//v/AwD9/wAABAADAAYA+v//////+f8CAAIAAQD///7/AwD8//v///8DAAcAAAD///v/9v/8/wYAAQAFAP7/9v/5////AAAEAAYA';

const SAMPLE_AUDIO = new Uint8Array(Buffer.from(SAMPLE_WAV_BASE64, 'base64'));

const LIVE_TIMEOUT_MS = 60_000;
const EXTENDED_LIVE_TIMEOUT_MS = 90_000;

describe('Venice live API contract', () => {
    it('returns text from a non-streaming chat completion', async () => {
        const result = await generateText({
            model: provider(chatModelId),
            prompt: 'Reply with the single word: ok',
            maxOutputTokens: 128,
            temperature: 0,
            maxRetries: 0,
        });

        expect(result.text.trim().length).toBeGreaterThan(0);
        expect(['stop', 'length']).toContain(result.finishReason);
    }, LIVE_TIMEOUT_MS);

    it('parses a streamed chat completion over SSE', async () => {
        const result = streamText({
            model: provider(chatModelId),
            prompt: 'Count from one to three.',
            maxOutputTokens: 128,
            temperature: 0,
            maxRetries: 0,
        });

        expect((await result.text).trim().length).toBeGreaterThan(0);
        expect(['stop', 'length']).toContain(await result.finishReason);
    }, LIVE_TIMEOUT_MS);

    it('transcribes multipart audio with segment timestamps', async () => {
        const result = await transcribe({
            model: provider.transcriptionModel(transcriptionModelId),
            audio: SAMPLE_AUDIO,
            timestampGranularities: ['segment'],
            maxRetries: 0,
        });

        expect(result.text.trim().length).toBeGreaterThan(0);
        expect(result.segments.length).toBeGreaterThan(0);

        for (const segment of result.segments) {
            expect(Number.isFinite(segment.startSecond)).toBe(true);
            expect(Number.isFinite(segment.endSecond)).toBe(true);
            expect(segment.startSecond).toBeGreaterThanOrEqual(0);
            expect(segment.endSecond).toBeGreaterThanOrEqual(segment.startSecond);
        }

        expect(typeof result.durationInSeconds).toBe('number');
        expect(result.durationInSeconds ?? 0).toBeGreaterThan(0);
    }, LIVE_TIMEOUT_MS);

    it('embeds a small batch and returns one vector per input in order', async () => {
        const values = ['Venice is a city in Italy.', 'The Grand Canal is its main waterway.'];

        const result = await embedMany({
            model: provider.embeddingModel(embeddingModelId),
            values,
            maxRetries: 0,
        });

        expect(result.embeddings).toHaveLength(values.length);
        expect(result.values).toEqual(values);

        const [firstVector = [], secondVector = []] = result.embeddings;
        expect(firstVector.length).toBeGreaterThan(0);
        expect(secondVector.length).toBe(firstVector.length);

        for (const vector of [firstVector, secondVector]) {
            const nonzero = vector.filter((value) => value !== 0);
            expect(nonzero.length).toBeGreaterThan(0);
            expect(vector.every((value) => Number.isFinite(value))).toBe(true);
        }

        expect(firstVector).not.toEqual(secondVector);
        expect(result.usage.tokens).toBeGreaterThan(0);
    }, LIVE_TIMEOUT_MS);

    it('executes a tool call and answers in a second step', async () => {
        const modelId = 'function_calling_default';

        const executed: Array<{ value: number }> = [];
        const result = await generateText({
            model: provider(modelId),
            prompt: 'Call the double tool exactly once with value 21, then report the doubled result.',
            tools: {
                double: tool({
                    description: 'Doubles a number.',
                    inputSchema: z.object({ value: z.number().int() }),
                    execute: async ({ value }) => {
                        executed.push({ value });
                        return { doubled: value * 2 };
                    },
                }),
            },
            stopWhen: isStepCount(2),
            maxOutputTokens: 512,
            temperature: 0,
            maxRetries: 0,
        });

        expect(executed).toEqual([{ value: 21 }]);
        expect(result.steps.length).toBeGreaterThanOrEqual(2);
        expect(result.text.trim().length).toBeGreaterThan(0);
    }, EXTENDED_LIVE_TIMEOUT_MS);

    it('returns schema-valid structured output over a stream', async () => {
        const modelId = await resolveTextModel(process.env.VENICE_E2E_STRUCTURED_MODEL, (model) => model.model_spec?.capabilities?.supportsResponseSchema === true);
        const structuredProvider = createVenice({ apiKey, supportsStructuredOutputs: true });

        const result = streamText({
            model: structuredProvider(modelId),
            output: Output.object({ schema: z.object({ answer: z.number().int(), label: z.string() }) }),
            prompt: 'Return JSON with answer set to 42 and label set to "forty-two".',
            maxOutputTokens: 512,
            temperature: 0,
            maxRetries: 0,
        });

        expect(await result.output).toEqual({ answer: 42, label: 'forty-two' });
    }, EXTENDED_LIVE_TIMEOUT_MS);

    it('synthesizes speech through the live audio endpoint', async () => {
        const result = await generateSpeech({
            model: provider.speechModel(speechModelId),
            text: 'Hello from Venice.',
            voice: speechVoice,
            outputFormat: 'mp3',
            maxRetries: 0,
        });

        expect(result.audio.uint8Array.length).toBeGreaterThan(0);
        expect(result.audio.mediaType).toBe('audio/mpeg');
    }, LIVE_TIMEOUT_MS);

    it('maps live web-search citations to AI SDK URL sources', async () => {
        const modelId = await resolveTextModel(process.env.VENICE_E2E_WEB_SEARCH_MODEL, (model) => model.model_spec?.capabilities?.supportsWebSearch === true);
        const result = await generateText({
            model: provider(modelId),
            prompt: 'Use a web source to answer: what is the capital of France?',
            maxOutputTokens: 512,
            temperature: 0,
            maxRetries: 0,
            providerOptions: {
                venice: {
                    veniceParameters: { enableWebSearch: 'on', enableWebCitations: true },
                },
            },
        });

        const sources = result.sources.filter((source) => source.sourceType === 'url');
        expect(sources.length).toBeGreaterThan(0);
        const source = sources[0]!;
        expect(source.id).toMatch(/^venice-web-search-\d+$/);
        expect(source.title?.length).toBeGreaterThan(0);
        expect(new URL(source.url).protocol).toMatch(/^https?:$/);
    }, EXTENDED_LIVE_TIMEOUT_MS);

    it('generates a PNG with the default image model and edits it with Qwen Turbo', async () => {
        const generated = await generateImage({
            model: provider.imageModel(imageGenerationModelId),
            prompt: 'A solid royal-blue square centered on a plain white background.',
            n: 1,
            maxImagesPerCall: 1,
            aspectRatio: '1:1',
            maxRetries: 0,
            providerOptions: { venice: { format: 'png', resolution: '1K' } },
        });

        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        expect(generated.images).toHaveLength(1);
        expect(Array.from(generated.image.uint8Array.subarray(0, pngSignature.length))).toEqual(pngSignature);

        const edited = await generateImage({
            model: provider.imageModel(imageEditModelId),
            prompt: {
                images: [generated.image.uint8Array],
                text: 'Replace the blue square with a red circle on the same white background.',
            },
            n: 1,
            maxImagesPerCall: 1,
            maxRetries: 0,
            providerOptions: { venice: { output_format: 'png', resolution: '1K' } },
        });

        expect(edited.images).toHaveLength(1);
        expect(Array.from(edited.image.uint8Array.subarray(0, pngSignature.length))).toEqual(pngSignature);
    }, 180_000);

    it('maps live decision answers and usage through experimental_decide', async () => {
        const result = await experimental_decide({
            model: provider.decisionModel(decisionModelId),
            state: [{ type: 'text', text: 'My payouts have failed for three days and nobody has replied. Please help as soon as possible.' }],
            questions: {
                urgent: { type: 'boolean', instructions: 'Does this support ticket require prompt attention?' },
                department: {
                    type: 'choice',
                    instructions: 'Which team should handle this ticket?',
                    criteria: { billing: 'Payments, invoices, or refunds', technical: 'Bugs, outages, or integrations' },
                },
            },
            maxRetries: 0,
        });

        const urgent = result.answers.urgent;
        if (urgent?.type !== 'boolean') throw new Error('Expected a boolean urgent answer.');
        expect(urgent.probability).toBeGreaterThanOrEqual(0);
        expect(urgent.probability).toBeLessThanOrEqual(1);

        const department = result.answers.department;
        if (department?.type !== 'choice') throw new Error('Expected a choice department answer.');
        expect(['billing', 'technical']).toContain(department.choice);
        expect(Object.keys(department.probabilities ?? {})).toHaveLength(2);
        expect(result.usage?.inputTokens).toBeGreaterThan(0);
        expect(result.usage?.outputTokens).toBeGreaterThanOrEqual(0);
    }, LIVE_TIMEOUT_MS);
});
