import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import type { VeniceChatConfig } from '../src/venice-chat-language-model';
import { VeniceChatLanguageModel } from '../src/venice-chat-language-model';
import { VeniceDecisionModel } from '../src/venice-decision-model';
import { VeniceImageModel } from '../src/venice-image-model';
import { createVenice } from '../src/venice-provider';
import { VeniceSpeechModel } from '../src/venice-speech-model';
import { VeniceTranscriptionModel } from '../src/venice-transcription-model';

function chatResponse(): Response {
    return new Response(
        JSON.stringify({
            id: 'cmpl-1',
            created: 1,
            model: 'chat-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
}

describe('VeniceProvider surface', () => {
    it('exposes speech, transcription, native image, and decision models', () => {
        const provider = createVenice({ apiKey: 'test', baseURL: 'https://api.test/v1' });

        const image = provider.imageModel('qwen-image');
        expect(image).toBeInstanceOf(VeniceImageModel);
        expect(image).toMatchObject({ specificationVersion: 'v4', provider: 'venice.image', modelId: 'qwen-image' });

        const speech = provider.speechModel('tts-model');
        expect(speech).toBeInstanceOf(VeniceSpeechModel);
        expect(speech).toMatchObject({ specificationVersion: 'v4', provider: 'venice.speech' });

        const transcription = provider.transcriptionModel('whisper');
        expect(transcription).toBeInstanceOf(VeniceTranscriptionModel);
        expect(transcription).toMatchObject({ specificationVersion: 'v4', provider: 'venice.transcription' });

        const decision = provider.decisionModel('jev-latest');
        expect(decision).toBeInstanceOf(VeniceDecisionModel);
        expect(decision).toMatchObject({ specificationVersion: 'v4', provider: 'venice.decision' });
    });
});

describe('Venice workflow serialization', () => {
    it('round-trips the chat model', () => {
        const provider = createVenice({ apiKey: 'test' });
        const model = provider('chat-model');

        const serialized = VeniceChatLanguageModel[WORKFLOW_SERIALIZE](model);
        expect(serialized.modelId).toBe('chat-model');

        const restored = VeniceChatLanguageModel[WORKFLOW_DESERIALIZE](serialized as unknown as { modelId: string; config: VeniceChatConfig });
        expect(restored.modelId).toBe('chat-model');
        expect(restored.provider).toBe('venice.chat');
    });

    it('round-trips the image model', () => {
        const provider = createVenice({ apiKey: 'test' });
        const model = provider.imageModel('qwen-image');

        const serialized = VeniceImageModel[WORKFLOW_SERIALIZE](model);
        expect(serialized.modelId).toBe('qwen-image');

        const restored = VeniceImageModel[WORKFLOW_DESERIALIZE](serialized);
        expect(restored.modelId).toBe('qwen-image');
        expect(restored.provider).toBe('venice.image');
    });
});

describe('custom provider name', () => {
    it('reads message-level cacheControl from the custom provider options key', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            requests.push(JSON.parse(String(init?.body)));
            return chatResponse();
        }) as FetchFunction;

        const provider = createVenice({ name: 'custom', apiKey: 'test', fetch });
        const prompt: LanguageModelV4CallOptions['prompt'] = [
            {
                role: 'user',
                content: [{ type: 'text', text: 'hi', providerOptions: { custom: { cacheControl: { type: 'ephemeral' } } } }],
            },
        ];

        await provider('claude-sonnet-5').doGenerate({ prompt });

        expect(requests[0]?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }]);
    });
});
