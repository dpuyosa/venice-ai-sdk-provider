import type { MetadataExtractor } from '@ai-sdk/openai-compatible';
import type { SharedV3ProviderMetadata } from '@ai-sdk/provider';
import type { VeniceChatResponse } from './venice-response';

export type { MetadataExtractor } from '@ai-sdk/openai-compatible';

export function createVeniceMetadataExtractor(providerName: string): MetadataExtractor {
    return {
        async extractMetadata({ parsedBody }: { parsedBody: unknown }): Promise<SharedV3ProviderMetadata | undefined> {
            const body = parsedBody as Partial<VeniceChatResponse>;
            const metadata: Record<string, unknown> = {};

            if (body.cost != null) {
                metadata.cost = body.cost;
            }

            const reasoningDetails = body.choices?.[0]?.message.reasoning_details;
            if (reasoningDetails != null && reasoningDetails.length > 0) {
                metadata.reasoningDetails = reasoningDetails;
            }

            if (body.choices?.[0]?.message.reasoning_encrypted != null) {
                metadata.reasoningEncrypted = body.choices[0].message.reasoning_encrypted;
            }

            const citations = body.venice_parameters?.web_search_citations;
            if (citations != null && citations.length > 0) {
                metadata.webSearchCitations = citations;
            }

            return Object.keys(metadata).length > 0 ? ({ [providerName]: metadata } as SharedV3ProviderMetadata) : undefined;
        },

        createStreamExtractor: () => ({
            processChunk() {},
            buildMetadata() {
                return undefined;
            },
        }),
    };
}
