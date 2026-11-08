import type { SharedV4Warning, TranscriptionModelV4, TranscriptionModelV4CallOptions } from '@ai-sdk/provider';
import {
    convertBase64ToUint8Array,
    createJsonErrorResponseHandler,
    createJsonResponseHandler,
    mediaTypeToExtension,
    postFormDataToApi,
    serializeModelOptions,
    WORKFLOW_DESERIALIZE,
    WORKFLOW_SERIALIZE,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { defaultVeniceErrorStructure } from './venice-error';
import type { VeniceModelConfig } from './venice-model-config';
import { parseModelProviderOptions, resolveRequestHeaders } from './venice-model-config';

const transcriptionProviderOptionsSchema = z.object({
    timestamps: z.boolean().optional(),
    language: z.string().optional(),
    responseFormat: z.string().optional(),
    prompt: z.string().optional(),
    temperature: z.number().optional(),
});

const transcriptionResponseSchema = z.looseObject({
    text: z.string(),
    duration: z.number().optional(),
    language: z.string().optional(),
    timestamps: z
        .looseObject({
            word: z.array(z.looseObject({ word: z.string(), start: z.number(), end: z.number() })).optional(),
            segment: z.array(z.looseObject({ text: z.string(), start: z.number(), end: z.number() })).optional(),
            char: z.array(z.looseObject({ char: z.string(), start: z.number(), end: z.number() })).optional(),
        })
        .optional(),
});

function toBlob(audio: Uint8Array | string): Blob {
    return audio instanceof Uint8Array ? new Blob([audio as Uint8Array<ArrayBuffer>]) : new Blob([convertBase64ToUint8Array(audio)]);
}

export class VeniceTranscriptionModel implements TranscriptionModelV4 {
    readonly specificationVersion = 'v4';

    private readonly failedResponseHandler = createJsonErrorResponseHandler(defaultVeniceErrorStructure);
    private readonly successfulResponseHandler = createJsonResponseHandler(transcriptionResponseSchema);

    static [WORKFLOW_SERIALIZE](model: VeniceTranscriptionModel) {
        return serializeModelOptions({
            modelId: model.modelId,
            config: model.config,
        });
    }

    static [WORKFLOW_DESERIALIZE](options: { modelId: string; config: VeniceModelConfig }) {
        return new VeniceTranscriptionModel(options.modelId, options.config);
    }

    get provider(): string {
        return this.config.provider;
    }

    constructor(
        readonly modelId: string,
        readonly config: VeniceModelConfig
    ) {}

    private async getArgs(options: TranscriptionModelV4CallOptions) {
        const warnings: SharedV4Warning[] = [];
        const veniceOptions = await parseModelProviderOptions({
            provider: this.config.provider,
            providerOptions: options.providerOptions,
            schema: transcriptionProviderOptionsSchema,
        });

        if (veniceOptions?.responseFormat === 'text') {
            warnings.push({
                type: 'unsupported',
                feature: 'responseFormat',
                details: 'Venice transcription always returns JSON; responseFormat text was ignored.',
            });
        }
        if (veniceOptions?.prompt != null) {
            warnings.push({ type: 'unsupported', feature: 'prompt', details: 'Venice transcription does not accept a prompt.' });
        }
        if (veniceOptions?.temperature != null) {
            warnings.push({ type: 'unsupported', feature: 'temperature', details: 'Venice transcription does not accept a temperature.' });
        }

        const formData = new FormData();
        formData.append('model', this.modelId);
        formData.append('response_format', 'json');
        formData.append('file', new File([toBlob(options.audio)], 'audio', { type: options.mediaType }), `audio.${mediaTypeToExtension(options.mediaType)}`);

        const wantsTimestamps = veniceOptions?.timestamps ?? (options.timestampGranularities?.length ?? 0) > 0;
        if (wantsTimestamps) formData.append('timestamps', 'true');

        if (veniceOptions?.language != null) formData.append('language', veniceOptions.language);

        return { formData, warnings, language: veniceOptions?.language };
    }

    async doGenerate(options: TranscriptionModelV4CallOptions): Promise<Awaited<ReturnType<TranscriptionModelV4['doGenerate']>>> {
        const { formData, warnings, language: requestedLanguage } = await this.getArgs(options);

        const { value: response, responseHeaders } = await postFormDataToApi({
            url: this.config.url({ path: '/audio/transcriptions', modelId: this.modelId }),
            headers: await resolveRequestHeaders(this.config.headers, options.headers),
            formData,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const words = response.timestamps?.word?.map((word) => ({ text: word.word, startSecond: word.start, endSecond: word.end }));
        const segments = response.timestamps?.segment?.map((segment) => ({ text: segment.text, startSecond: segment.start, endSecond: segment.end })) ?? words ?? [];

        return {
            text: response.text,
            segments,
            ...(words != null && words.length > 0 ? { words } : {}),
            language: response.language ?? requestedLanguage,
            durationInSeconds: response.duration,
            warnings,
            response: {
                timestamp: new Date(),
                modelId: this.modelId,
                headers: responseHeaders,
            },
        };
    }
}
