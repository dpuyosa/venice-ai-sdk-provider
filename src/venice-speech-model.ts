import type { SharedV4Warning, SpeechModelV4, SpeechModelV4CallOptions } from '@ai-sdk/provider';
import { createBinaryResponseHandler, createJsonErrorResponseHandler, postJsonToApi, serializeModelOptions, WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { defaultVeniceErrorStructure } from './venice-error';
import type { VeniceModelConfig } from './venice-model-config';
import { parseModelProviderOptions, resolveRequestHeaders } from './venice-model-config';

const speechProviderOptionsSchema = z.object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    streaming: z.boolean().optional(),
});

const MAX_INSTRUCTIONS_LENGTH = 500;

const OUTPUT_FORMATS: Record<string, string> = {
    mp3: 'mp3',
    mpeg: 'mp3',
    wav: 'wav',
    wave: 'wav',
    opus: 'opus',
    aac: 'aac',
    flac: 'flac',
    pcm: 'pcm',
    pcm16: 'pcm',
};

function resolveOutputFormat(outputFormat: string | undefined, warnings: SharedV4Warning[]): string {
    if (outputFormat == null) return 'mp3';

    const normalized = OUTPUT_FORMATS[outputFormat.toLowerCase()];
    if (normalized != null) return normalized;

    warnings.push({
        type: 'unsupported',
        feature: 'outputFormat',
        details: `Unsupported output format: ${outputFormat}. Using mp3 instead.`,
    });
    return 'mp3';
}

function truncateInstructions(instructions: string | undefined, warnings: SharedV4Warning[]): string | undefined {
    if (instructions == null || instructions.length <= MAX_INSTRUCTIONS_LENGTH) return instructions;

    warnings.push({
        type: 'other',
        message: `Venice speech instructions are limited to ${MAX_INSTRUCTIONS_LENGTH} characters; the value was truncated.`,
    });
    return instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);
}

export class VeniceSpeechModel implements SpeechModelV4 {
    readonly specificationVersion = 'v4';

    private readonly failedResponseHandler = createJsonErrorResponseHandler(defaultVeniceErrorStructure);

    static [WORKFLOW_SERIALIZE](model: VeniceSpeechModel) {
        return serializeModelOptions({
            modelId: model.modelId,
            config: model.config,
        });
    }

    static [WORKFLOW_DESERIALIZE](options: { modelId: string; config: VeniceModelConfig }) {
        return new VeniceSpeechModel(options.modelId, options.config);
    }

    get provider(): string {
        return this.config.provider;
    }

    constructor(
        readonly modelId: string,
        readonly config: VeniceModelConfig
    ) {}

    private async getArgs(options: SpeechModelV4CallOptions) {
        const warnings: SharedV4Warning[] = [];
        const veniceOptions = await parseModelProviderOptions({
            provider: this.config.provider,
            providerOptions: options.providerOptions,
            schema: speechProviderOptionsSchema,
        });

        if (veniceOptions?.streaming === true) {
            warnings.push({
                type: 'unsupported',
                feature: 'streaming',
                details: 'Venice speech synthesis streaming is not supported by SpeechModelV4; the option was ignored.',
            });
        }

        const body: Record<string, unknown> = {
            model: this.modelId,
            input: options.text,
            response_format: resolveOutputFormat(options.outputFormat, warnings),
        };

        if (options.voice != null) body.voice = options.voice;
        if (options.speed != null) body.speed = options.speed;
        if (options.language != null) body.language = options.language;

        const instructions = truncateInstructions(options.instructions, warnings);
        if (instructions != null) body.prompt = instructions;

        if (veniceOptions?.temperature != null) body.temperature = veniceOptions.temperature;
        if (veniceOptions?.topP != null) body.top_p = veniceOptions.topP;

        return { body, warnings };
    }

    async doGenerate(options: SpeechModelV4CallOptions): Promise<Awaited<ReturnType<SpeechModelV4['doGenerate']>>> {
        const { body, warnings } = await this.getArgs(options);

        const { value: audio, responseHeaders } = await postJsonToApi({
            url: this.config.url({ path: '/audio/speech', modelId: this.modelId }),
            headers: await resolveRequestHeaders(this.config.headers, options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: createBinaryResponseHandler(),
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        return {
            audio,
            warnings,
            request: { body: JSON.stringify(body) },
            response: {
                timestamp: new Date(),
                modelId: this.modelId,
                headers: responseHeaders,
            },
        };
    }
}
