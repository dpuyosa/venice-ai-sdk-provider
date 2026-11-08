import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { VeniceDecisionModel } from '../src/venice-decision-model';

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
    const model = new VeniceDecisionModel('jev-latest', {
        provider: 'venice.decision',
        url: ({ path }) => `https://api.test/v1${path}`,
        headers: () => ({}),
        fetch,
    });
    return { model, requests };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const answersResponse = {
    model: 'jev-latest',
    answers: {
        urgent: { type: 'noul', noul: 0.9 },
        dept: { type: 'choice', choice: 'billing', probabilities: { billing: 1 } },
        severity: { type: 'score', score: 1.5, probabilities: { '0': 0.1, '1': 0.3, '2': 0.6 } },
        other: { type: 'unexpected' },
    },
    usage: { input_tokens: 11, output_tokens: 7 },
};

describe('VeniceDecisionModel', () => {
    it('maps boolean, choice, and score questions to noul/choice/score', async () => {
        const { model, requests } = createModel(() => jsonResponse(answersResponse));

        const result = await model.doDecide({
            state: [{ type: 'text', text: 'The service is down.' }],
            questions: {
                urgent: { type: 'boolean', instructions: 'Is it urgent?', criteria: { true: 'urgent', false: null } },
                dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Payments', technical: null } },
                severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', null, 'High'] },
            },
        });

        expect(requests[0]?.url).toBe('https://api.test/v1/decisions');
        expect(requests[0]?.body).toEqual({
            model: 'jev-latest',
            state: 'The service is down.',
            questions: {
                urgent: { type: 'noul', instructions: 'Is it urgent?', criteria: { true: 'urgent' } },
                dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Payments', technical: null } },
                severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'Level 2', 'High'] },
            },
        });
        expect(result.answers).toEqual({
            urgent: { type: 'boolean', probability: 0.9 },
            dept: { type: 'choice', choice: 'billing', probabilities: { billing: 1 } },
            severity: { type: 'score', score: 1.5, probabilities: { '0': 0.1, '1': 0.3, '2': 0.6 } },
            other: { type: 'refusal' },
        });
        expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
        expect(result.response?.modelId).toBe('jev-latest');
    });

    it('uses a single JSON part as the state and converts image parts to data URIs', async () => {
        const { model, requests } = createModel(() => jsonResponse(answersResponse));

        await model.doDecide({
            state: [{ type: 'json', value: { plan: 'pro' } }],
            questions: { urgent: { type: 'boolean', instructions: 'Is it urgent?' } },
        });
        expect(requests[0]?.body.state).toEqual({ plan: 'pro' });

        await model.doDecide({
            state: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: new Uint8Array([1, 2, 3]) } }],
            questions: { urgent: { type: 'boolean', instructions: 'Is it urgent?' } },
        });
        expect(requests[1]?.body.state).toBe('See attached image(s).');
        expect(requests[1]?.body.images).toEqual(['data:image/png;base64,AQID']);

        await model.doDecide({
            state: [
                { type: 'text', text: 'context' },
                { type: 'json', value: { a: 1 } },
            ],
            questions: { urgent: { type: 'boolean', instructions: 'Is it urgent?' } },
        });
        expect(requests[2]?.body.state).toEqual(['context', { a: 1 }]);
    });

    it('synthesizes instructions and warns about unsupported options', async () => {
        const { model, requests } = createModel(() => jsonResponse(answersResponse));

        const result = await model.doDecide({
            state: [{ type: 'text', text: 'state' }],
            questions: { dept: { type: 'choice', criteria: { a: null, b: null } } },
            maxOutputTokens: 100,
            reasoning: 'high',
        });

        expect(requests[0]?.body.questions).toEqual({
            dept: { type: 'choice', instructions: 'Choose the option that best describes the state.', criteria: { a: null, b: null } },
        });
        expect(result.warnings).toEqual([
            { type: 'unsupported', feature: 'maxOutputTokens', details: 'Venice decisions do not accept maxOutputTokens.' },
            { type: 'unsupported', feature: 'reasoning', details: 'Venice decisions do not accept reasoning settings.' },
        ]);
    });

    it('rejects box questions, short score rubrics, and remote image references', async () => {
        const { model } = createModel(() => jsonResponse(answersResponse));

        expect(model.supportedQuestionTypes).toEqual(['boolean', 'choice', 'score']);

        await expect(model.doDecide({ state: [{ type: 'text', text: 'x' }], questions: { box: { type: 'box', instructions: 'Where?' } } })).rejects.toBeInstanceOf(
            UnsupportedFunctionalityError
        );

        await expect(
            model.doDecide({ state: [{ type: 'text', text: 'x' }], questions: { score: { type: 'score', instructions: 'Rate', criteria: ['only'] } } })
        ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);

        await expect(
            model.doDecide({
                state: [{ type: 'file', mediaType: 'image/png', data: { type: 'url', url: new URL('https://example.com/a.png') } }],
                questions: { urgent: { type: 'boolean', instructions: 'Is it urgent?' } },
            })
        ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    });
});
