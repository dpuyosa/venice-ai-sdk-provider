import type { JSONValue } from '@ai-sdk/provider';

export type VeniceChatPrompt = Array<VeniceMessage>;

export type VeniceMessage = VeniceSystemMessage | VeniceUserMessage | VeniceAssistantMessage | VeniceToolMessage;

// Allow for arbitrary additional properties for general purpose
// provider-metadata-specific extensibility.
type JsonRecord<T = never> = Record<string, JSONValue | JSONValue[] | T | T[] | undefined>;

export interface VeniceSystemMessage extends JsonRecord<VeniceContentPartText> {
    role: 'system';
    content: string | Array<VeniceContentPartText>;
}

export interface VeniceUserMessage extends JsonRecord<VeniceContentPartText | VeniceContentPartImage> {
    role: 'user';
    content: string | Array<VeniceContentPartText | VeniceContentPartImage>;
}
export interface VeniceAssistantMessage extends JsonRecord<VeniceContentPartText | VeniceMessageToolCall> {
    role: 'assistant';
    content: string | Array<VeniceContentPartText>;
    tool_calls?: Array<VeniceMessageToolCall>;
}

export interface VeniceToolMessage extends JsonRecord<VeniceContentPartText> {
    role: 'tool';
    content: string | Array<VeniceContentPartText>;
    tool_call_id: string;
}

export interface VeniceContentPartImage extends JsonRecord {
    type: 'image_url';
    image_url: { url: string };
}

export interface VeniceContentPartText extends JsonRecord {
    type: 'text';
    text: string;
}

export interface VeniceMessageToolCall extends JsonRecord {
    type: 'function';
    id: string;
    function: {
        arguments: string;
        name: string;
    };
}
