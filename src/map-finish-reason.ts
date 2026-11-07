import type { LanguageModelV4FinishReason } from '@ai-sdk/provider';

export function mapFinishReason(finishReason: string | null | undefined, { hasRefusal = false, hasToolCalls = false }: { hasRefusal?: boolean; hasToolCalls?: boolean } = {}): LanguageModelV4FinishReason['unified'] {
    switch (finishReason) {
        case 'stop':
            return hasRefusal ? 'content-filter' : 'stop';
        case 'length':
            return 'length';
        case 'content_filter':
            return 'content-filter';
        case 'function_call':
        case 'tool_calls':
            return 'tool-calls';
        default:
            return hasToolCalls ? 'tool-calls' : 'other';
    }
}
