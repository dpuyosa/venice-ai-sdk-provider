interface VeniceParametersInput {
    enableWebSearch?: "off" | "on" | "auto";
    enableWebScraping?: boolean;
    enableWebCitations?: boolean;
    stripThinkingResponse?: boolean;
    disableThinking?: boolean;
    includeVeniceSystemPrompt?: boolean;
    characterSlug?: string;
    includeSearchResultsInStream?: boolean;
    returnSearchResultsAsDocuments?: boolean;
}

interface VeniceParametersOutput {
    enable_web_search?: "off" | "on" | "auto";
    enable_web_scraping?: boolean;
    enable_web_citations?: boolean;
    strip_thinking_response?: boolean;
    disable_thinking?: boolean;
    include_venice_system_prompt?: boolean;
    character_slug?: string;
    include_search_results_in_stream?: boolean;
    return_search_results_as_documents?: boolean;
}

export function prepareVeniceParameters({ veniceParameters }: { veniceParameters: VeniceParametersInput | undefined }): VeniceParametersOutput | undefined {
    if (veniceParameters == null) {
        return undefined;
    }

    const result: Record<string, unknown> = {};

    if (veniceParameters.enableWebSearch !== undefined) {
        result.enable_web_search = veniceParameters.enableWebSearch;
    }
    if (veniceParameters.enableWebScraping !== undefined) {
        result.enable_web_scraping = veniceParameters.enableWebScraping;
    }
    if (veniceParameters.enableWebCitations !== undefined) {
        result.enable_web_citations = veniceParameters.enableWebCitations;
    }
    if (veniceParameters.stripThinkingResponse !== undefined) {
        result.strip_thinking_response = veniceParameters.stripThinkingResponse;
    }
    if (veniceParameters.disableThinking !== undefined) {
        result.disable_thinking = veniceParameters.disableThinking;
    }
    if (veniceParameters.includeVeniceSystemPrompt !== undefined) {
        result.include_venice_system_prompt = veniceParameters.includeVeniceSystemPrompt;
    }
    if (veniceParameters.characterSlug !== undefined) {
        result.character_slug = veniceParameters.characterSlug;
    }
    if (veniceParameters.includeSearchResultsInStream !== undefined) {
        result.include_search_results_in_stream = veniceParameters.includeSearchResultsInStream;
    }
    if (veniceParameters.returnSearchResultsAsDocuments !== undefined) {
        result.return_search_results_as_documents = veniceParameters.returnSearchResultsAsDocuments;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}
