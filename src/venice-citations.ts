import type { LanguageModelV4Source } from '@ai-sdk/provider';
import type { VeniceChatResponse } from './venice-response';

export type VeniceWebSearchCitations = NonNullable<NonNullable<VeniceChatResponse['venice_parameters']>['web_search_citations']>;

export function buildVeniceSources(citations: VeniceWebSearchCitations): LanguageModelV4Source[] {
    const seenUrls = new Set<string>();
    const sources: LanguageModelV4Source[] = [];

    citations.forEach((citation, index) => {
        if (seenUrls.has(citation.url)) return;
        seenUrls.add(citation.url);

        const metadata = {
            ...(citation.content != null ? { content: citation.content } : {}),
            ...(citation.date != null ? { date: citation.date } : {}),
        };

        sources.push({
            type: 'source',
            sourceType: 'url',
            id: `venice-web-search-${index}`,
            url: citation.url,
            title: citation.title,
            ...(Object.keys(metadata).length > 0 ? { providerMetadata: { venice: metadata } } : {}),
        });
    });

    return sources;
}
