import type { LanguageModelV4Citation } from '@ai-sdk/provider';
import type { VeniceChatResponse } from './venice-response';

export type VeniceWebSearchCitations = NonNullable<NonNullable<VeniceChatResponse['venice_parameters']>['web_search_citations']>;

export function buildVeniceCitations(citations: VeniceWebSearchCitations): LanguageModelV4Citation[] {
    return citations.map((citation, index) => ({
        source: {
            type: 'source',
            sourceType: 'url',
            id: `venice-web-search-${index}`,
            url: citation.url,
            title: citation.title,
        },
        ...(citation.content == null ? {} : { citedText: citation.content }),
    }));
}
