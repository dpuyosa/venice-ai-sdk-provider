import type { ImageModelV4, ImageModelV4CallOptions, ImageModelV4File, SharedV4Warning } from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import { convertToBase64, createBinaryResponseHandler, createJsonErrorResponseHandler, createJsonResponseHandler, postJsonToApi, serializeModelOptions, WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { defaultVeniceErrorStructure } from './venice-error';
import type { VeniceModelConfig } from './venice-model-config';
import { getModelProviderOptions, resolveRequestHeaders } from './venice-model-config';

type ImageGenerateResult = Awaited<ReturnType<ImageModelV4['doGenerate']>>;

const imageResponseSchema = z.object({
    images: z.array(z.string()),
});

const MAX_NATIVE_DIMENSION = 1280;

const NATIVE_IMAGE_FIELDS = [
    'quality',
    'resolution',
    'negative_prompt',
    'style_preset',
    'cfg_scale',
    'enhance_prompt',
    'hide_watermark',
    'safe_mode',
    'transparent_background',
    'anon_user_id',
    'style_references',
    'enable_web_search',
    'disable_prompt_optimization_thinking',
    'embed_exif_metadata',
    'lora_strength',
    'steps',
] as const;

const UNSUPPORTED_IMAGE_FIELDS = ['output_compression', 'style', 'user', 'response_format'] as const;

const EDIT_FIELDS = ['enhance_prompt', 'disable_prompt_optimization_thinking', 'anon_user_id'] as const;

function resolveFormat(options: Record<string, unknown>): string {
    const format = options.format ?? options.output_format;
    return typeof format === 'string' ? format : 'png';
}

function applyDimensions(body: Record<string, unknown>, { size, aspectRatio }: Pick<ImageModelV4CallOptions, 'size' | 'aspectRatio'>): void {
    if (aspectRatio != null) {
        body.aspect_ratio = aspectRatio;
        return;
    }

    if (size == null) return;

    const [rawWidth, rawHeight] = size.split('x');
    const width = Number(rawWidth);
    const height = Number(rawHeight);

    if (width > MAX_NATIVE_DIMENSION || height > MAX_NATIVE_DIMENSION) {
        throw new UnsupportedFunctionalityError({
            functionality: 'image size larger than 1280px',
            message: `Venice image generation supports a maximum width and height of ${MAX_NATIVE_DIMENSION}px. Use 'aspectRatio' (with the 'resolution' provider option) instead of size '${size}'.`,
        });
    }

    body.width = width;
    body.height = height;
}

function warnIgnoredFields(options: Record<string, unknown>, warnings: SharedV4Warning[]): void {
    for (const field of UNSUPPORTED_IMAGE_FIELDS) {
        if (options[field] != null) {
            warnings.push({
                type: 'unsupported',
                feature: field,
                details: `Venice image models do not support the '${field}' provider option.`,
            });
        }
    }
}

function forcePngForTransparency(body: Record<string, unknown>, formatKey: 'format' | 'output_format'): void {
    if (body.transparent_background === true && body[formatKey] === 'jpeg') {
        body[formatKey] = 'png';
    }
}

function applyGenerationOptions(body: Record<string, unknown>, options: Record<string, unknown>, warnings: SharedV4Warning[]): void {
    body.format = resolveFormat(options);

    for (const field of NATIVE_IMAGE_FIELDS) {
        if (options[field] !== undefined) body[field] = options[field];
    }

    if (body.transparent_background === undefined && options.background === 'transparent') {
        body.transparent_background = true;
    }

    forcePngForTransparency(body, 'format');

    if (options.safe_mode === undefined && options.moderation === 'low') {
        body.safe_mode = false;
    }

    warnIgnoredFields(options, warnings);
}

function applyEditOptions(body: Record<string, unknown>, options: Record<string, unknown>, warnings: SharedV4Warning[]): void {
    if (options.resolution !== undefined) body.resolution = options.resolution;

    const outputFormat = options.output_format ?? options.format;
    if (typeof outputFormat === 'string') body.output_format = outputFormat;

    if (options.safe_mode !== undefined) body.safe_mode = options.safe_mode;
    else if (options.moderation === 'low') body.safe_mode = false;

    if (options.transparent_background !== undefined) body.transparent_background = options.transparent_background;
    else if (options.background === 'transparent') body.transparent_background = true;

    forcePngForTransparency(body, 'output_format');

    for (const field of EDIT_FIELDS) {
        if (options[field] !== undefined) body[field] = options[field];
    }

    if (options.quality != null) {
        warnings.push({
            type: 'unsupported',
            feature: 'quality',
            details: "Venice '/image/edit' does not support the 'quality' provider option.",
        });
    }

    warnIgnoredFields(options, warnings);
}

function fileToImageSource(file: ImageModelV4File): string {
    if (file.type === 'url') return file.url;
    return `data:${file.mediaType};base64,${convertToBase64(file.data)}`;
}

export class VeniceImageModel implements ImageModelV4 {
    readonly specificationVersion = 'v4';
    readonly maxImagesPerCall = 4;
    readonly supportsFileInputs = true;
    readonly supportsMaskInputs = false;

    private readonly failedResponseHandler = createJsonErrorResponseHandler(defaultVeniceErrorStructure);
    private readonly successfulResponseHandler = createJsonResponseHandler(imageResponseSchema);

    static [WORKFLOW_SERIALIZE](model: VeniceImageModel) {
        return serializeModelOptions({
            modelId: model.modelId,
            config: model.config,
        });
    }

    static [WORKFLOW_DESERIALIZE](options: { modelId: string; config: VeniceModelConfig }) {
        return new VeniceImageModel(options.modelId, options.config);
    }

    get provider(): string {
        return this.config.provider;
    }

    constructor(
        readonly modelId: string,
        readonly config: VeniceModelConfig
    ) {}

    private async generateImages(options: ImageModelV4CallOptions, warnings: SharedV4Warning[]): Promise<ImageGenerateResult> {
        const body: Record<string, unknown> = {
            model: this.modelId,
            prompt: options.prompt ?? '',
            variants: options.n,
            return_binary: false,
        };

        applyDimensions(body, options);
        if (options.seed !== undefined) body.seed = options.seed;
        applyGenerationOptions(body, getModelProviderOptions(this.config.provider, options.providerOptions), warnings);

        const { value: response, responseHeaders } = await postJsonToApi({
            url: this.config.url({ path: '/image/generate', modelId: this.modelId }),
            headers: await resolveRequestHeaders(this.config.headers, options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        const responseMetadata = { timestamp: new Date(), modelId: this.modelId, headers: responseHeaders };

        if (response.images.length === 0) {
            return { images: [], warnings, isRetryable: true, response: responseMetadata };
        }

        if (response.images.length < options.n) {
            warnings.push({
                type: 'other',
                message: `Venice returned ${response.images.length} image(s) but ${options.n} were requested.`,
            });
        }

        return { images: response.images, warnings, response: responseMetadata };
    }

    private async requestEdit(body: Record<string, unknown>, options: ImageModelV4CallOptions) {
        return postJsonToApi({
            url: this.config.url({ path: '/image/edit', modelId: this.modelId }),
            headers: await resolveRequestHeaders(this.config.headers, options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: createBinaryResponseHandler(),
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });
    }

    private async generateEdits(options: ImageModelV4CallOptions, warnings: SharedV4Warning[]): Promise<ImageGenerateResult> {
        if (options.mask != null) {
            throw new UnsupportedFunctionalityError({
                functionality: 'image mask (inpainting)',
                message: 'Venice image editing does not support masks.',
            });
        }

        const files = options.files ?? [];
        const file = files[0];

        if (files.length !== 1 || file == null) {
            throw new UnsupportedFunctionalityError({
                functionality: 'editing multiple input images',
                message: "Venice '/image/edit' edits a single input image. Multi-image editing is not supported.",
            });
        }

        const body: Record<string, unknown> = {
            model: this.modelId,
            prompt: options.prompt ?? '',
            image: fileToImageSource(file),
        };

        if (options.aspectRatio != null) body.aspect_ratio = options.aspectRatio;

        if (options.size != null) {
            warnings.push({
                type: 'unsupported',
                feature: 'size',
                details: "Venice '/image/edit' does not accept size; use aspectRatio and the 'resolution' provider option.",
            });
        }
        if (options.seed != null) {
            warnings.push({ type: 'unsupported', feature: 'seed', details: "Venice '/image/edit' does not accept a seed." });
        }

        applyEditOptions(body, getModelProviderOptions(this.config.provider, options.providerOptions), warnings);

        const results = await Promise.all(Array.from({ length: options.n }, () => this.requestEdit(body, options)));

        return {
            images: results.map((result) => result.value),
            warnings,
            response: { timestamp: new Date(), modelId: this.modelId, headers: results[0]?.responseHeaders },
        };
    }

    async doGenerate(options: ImageModelV4CallOptions): Promise<ImageGenerateResult> {
        const warnings: SharedV4Warning[] = [];

        if (options.files != null && options.files.length > 0) {
            return this.generateEdits(options, warnings);
        }

        return this.generateImages(options, warnings);
    }
}
