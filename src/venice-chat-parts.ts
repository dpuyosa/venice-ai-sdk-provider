import type { JSONValue } from '@ai-sdk/provider';

export type VeniceChatPrompt = Array<VeniceMessage>;

export type VeniceMessage = VeniceSystemMessage | VeniceUserMessage | VeniceAssistantMessage | VeniceToolMessage;

// Allow for arbitrary additional properties for general purpose
// provider-metadata-specific extensibility.
type JsonRecord<T = never> = Record<string, JSONValue | JSONValue[] | T | T[] | undefined>;

export interface VeniceSystemMessage extends JsonRecord {
    role: 'system';
    content: string;
}

export interface VeniceUserMessage extends JsonRecord<VeniceContentPart> {
    role: 'user';
    content: string | Array<VeniceContentPart>;
}

export type VeniceContentPart = VeniceContentPartText | VeniceContentPartImage;

export interface VeniceContentPartImage extends JsonRecord {
    type: 'image_url';
    image_url: { url: string };
}

export interface VeniceContentPartText extends JsonRecord {
    type: 'text';
    text: string;
}

export interface VeniceAssistantMessage extends JsonRecord<VeniceMessageToolCall> {
    role: 'assistant';
    content?: string | null;
    tool_calls?: Array<VeniceMessageToolCall>;
}

export interface VeniceMessageToolCall extends JsonRecord {
    type: 'function';
    id: string;
    function: {
        arguments: string;
        name: string;
    };
}

export interface VeniceToolMessage extends JsonRecord {
    role: 'tool';
    content: string;
    tool_call_id: string;
}
