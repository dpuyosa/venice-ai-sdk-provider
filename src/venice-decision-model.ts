import type {
    Experimental_DecisionModelV4,
    Experimental_DecisionModelV4Answer,
    Experimental_DecisionModelV4CallOptions,
    Experimental_DecisionModelV4Input,
    Experimental_DecisionModelV4Question,
    Experimental_DecisionModelV4Result,
    Experimental_DecisionModelV4State,
    LanguageModelV4FilePart,
    SharedV4Warning,
} from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import { convertToBase64, createJsonErrorResponseHandler, createJsonResponseHandler, postJsonToApi, serializeModelOptions, WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { defaultVeniceErrorStructure } from './venice-error';
import type { VeniceModelConfig } from './venice-model-config';
import { resolveRequestHeaders } from './venice-model-config';

const MAX_DECISION_IMAGES = 4;

const decisionAnswerSchema = z.looseObject({
    type: z.string(),
    noul: z.number().optional(),
    choice: z.string().optional(),
    score: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
});

const decisionResponseSchema = z.looseObject({
    model: z.string().optional(),
    answers: z.record(z.string(), decisionAnswerSchema),
    usage: z
        .looseObject({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
        })
        .optional(),
});

const DEFAULT_INSTRUCTIONS = {
    boolean: 'Decide whether the statement described by the criteria is true for the state.',
    choice: 'Choose the option that best describes the state.',
    score: 'Score the state using the provided levels from lowest to highest.',
} as const;

function stringifyInput(input: Experimental_DecisionModelV4Input): string {
    return typeof input === 'string' ? input : JSON.stringify(input);
}

function resolveInstructions(instructions: Experimental_DecisionModelV4Input | null | undefined, fallback: string): string {
    return instructions != null ? stringifyInput(instructions) : fallback;
}

function filePartToDataUri(part: LanguageModelV4FilePart): string {
    if (part.data.type !== 'data') {
        throw new UnsupportedFunctionalityError({
            functionality: `decision state file with '${part.data.type}' data`,
            message: 'Venice decisions accept inline PNG or JPEG image data only.',
        });
    }

    const mediaType = part.mediaType.toLowerCase();
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') {
        throw new UnsupportedFunctionalityError({
            functionality: `decision state media type ${part.mediaType}`,
            message: 'Venice decisions accept PNG or JPEG images only.',
        });
    }

    return `data:${mediaType};base64,${convertToBase64(part.data.data)}`;
}

function buildState(parts: Experimental_DecisionModelV4State): { state: unknown; images: string[] } {
    const textParts: string[] = [];
    const jsonValues: unknown[] = [];
    const images: string[] = [];

    for (const part of parts) {
        if (part.type === 'text') textParts.push(part.text);
        else if (part.type === 'json') jsonValues.push(part.value);
        else images.push(filePartToDataUri(part));
    }

    const text = textParts.join('\n');
    const values: unknown[] = text.length > 0 ? [text, ...jsonValues] : jsonValues;

    if (values.length === 0) {
        return { state: images.length > 0 ? 'See attached image(s).' : '', images };
    }

    return { state: values.length === 1 ? values[0] : values, images };
}

function mapBooleanQuestion(question: Extract<Experimental_DecisionModelV4Question, { type: 'boolean' }>): Record<string, unknown> {
    const criteria = question.criteria;
    const mappedCriteria: Record<string, string> = {};

    if (criteria?.true != null) mappedCriteria.true = stringifyInput(criteria.true);
    if (criteria?.false != null) mappedCriteria.false = stringifyInput(criteria.false);

    return {
        type: 'noul',
        instructions: resolveInstructions(question.instructions, DEFAULT_INSTRUCTIONS.boolean),
        ...(Object.keys(mappedCriteria).length > 0 ? { criteria: mappedCriteria } : {}),
    };
}

function mapChoiceQuestion(question: Extract<Experimental_DecisionModelV4Question, { type: 'choice' }>): Record<string, unknown> {
    const criteria = Object.fromEntries(Object.entries(question.criteria).map(([option, description]) => [option, description == null ? null : stringifyInput(description)]));

    return {
        type: 'choice',
        instructions: resolveInstructions(question.instructions, DEFAULT_INSTRUCTIONS.choice),
        criteria,
    };
}

function mapScoreQuestion(question: Extract<Experimental_DecisionModelV4Question, { type: 'score' }>): Record<string, unknown> {
    if (question.criteria.length < 2) {
        throw new UnsupportedFunctionalityError({
            functionality: 'score question with fewer than 2 levels',
            message: 'Venice score questions require at least 2 levels.',
        });
    }

    return {
        type: 'score',
        instructions: resolveInstructions(question.instructions, DEFAULT_INSTRUCTIONS.score),
        criteria: question.criteria.map((level, index) => (level == null ? `Level ${index + 1}` : stringifyInput(level))),
    };
}

function mapQuestion(question: Experimental_DecisionModelV4Question): Record<string, unknown> {
    switch (question.type) {
        case 'boolean':
            return mapBooleanQuestion(question);
        case 'choice':
            return mapChoiceQuestion(question);
        case 'score':
            return mapScoreQuestion(question);
        default:
            throw new UnsupportedFunctionalityError({
                functionality: `decision question type ${question.type}`,
            });
    }
}

function mapQuestions(questions: Readonly<Record<string, Experimental_DecisionModelV4Question>>): Record<string, Record<string, unknown>> {
    return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, mapQuestion(question)]));
}

function mapAnswer(answer: z.infer<typeof decisionAnswerSchema>): Experimental_DecisionModelV4Answer {
    switch (answer.type) {
        case 'noul':
            return { type: 'boolean', probability: answer.noul ?? 0 };
        case 'choice':
            return { type: 'choice', choice: answer.choice ?? '', ...(answer.probabilities != null ? { probabilities: answer.probabilities } : {}) };
        case 'score':
            return { type: 'score', score: answer.score ?? 0, ...(answer.probabilities != null ? { probabilities: answer.probabilities } : {}) };
        default:
            return { type: 'refusal' };
    }
}

export class VeniceDecisionModel implements Experimental_DecisionModelV4 {
    readonly specificationVersion = 'v4';
    readonly supportedQuestionTypes = ['boolean', 'choice', 'score'] as const;

    private readonly failedResponseHandler = createJsonErrorResponseHandler(defaultVeniceErrorStructure);
    private readonly successfulResponseHandler = createJsonResponseHandler(decisionResponseSchema);

    static [WORKFLOW_SERIALIZE](model: VeniceDecisionModel) {
        return serializeModelOptions({
            modelId: model.modelId,
            config: model.config,
        });
    }

    static [WORKFLOW_DESERIALIZE](options: { modelId: string; config: VeniceModelConfig }) {
        return new VeniceDecisionModel(options.modelId, options.config);
    }

    get provider(): string {
        return this.config.provider;
    }

    constructor(
        readonly modelId: string,
        readonly config: VeniceModelConfig
    ) {}

    async doDecide(options: Experimental_DecisionModelV4CallOptions): Promise<Experimental_DecisionModelV4Result> {
        const warnings: SharedV4Warning[] = [];

        if (options.maxOutputTokens != null) {
            warnings.push({ type: 'unsupported', feature: 'maxOutputTokens', details: 'Venice decisions do not accept maxOutputTokens.' });
        }
        if (options.reasoning != null) {
            warnings.push({ type: 'unsupported', feature: 'reasoning', details: 'Venice decisions do not accept reasoning settings.' });
        }

        if (options.state.filter((part) => part.type === 'file').length > MAX_DECISION_IMAGES) {
            throw new UnsupportedFunctionalityError({
                functionality: `more than ${MAX_DECISION_IMAGES} decision images`,
                message: `Venice decisions accept at most ${MAX_DECISION_IMAGES} images.`,
            });
        }

        const { state, images } = buildState(options.state);

        const body: Record<string, unknown> = {
            model: this.modelId,
            state,
            questions: mapQuestions(options.questions),
        };
        if (images.length > 0) body.images = images;

        const { value: response, responseHeaders } = await postJsonToApi({
            url: this.config.url({ path: '/decisions', modelId: this.modelId }),
            headers: await resolveRequestHeaders(this.config.headers, options.headers),
            body,
            failedResponseHandler: this.failedResponseHandler,
            successfulResponseHandler: this.successfulResponseHandler,
            abortSignal: options.abortSignal,
            fetch: this.config.fetch,
        });

        return {
            answers: Object.fromEntries(Object.entries(response.answers).map(([id, answer]) => [id, mapAnswer(answer)])),
            usage:
                response.usage != null
                    ? {
                          inputTokens: response.usage.input_tokens,
                          outputTokens: response.usage.output_tokens,
                      }
                    : undefined,
            warnings,
            response: {
                timestamp: new Date(),
                modelId: response.model ?? this.modelId,
                headers: responseHeaders,
            },
        };
    }
}
