import type { JSONValue } from '@ai-sdk/provider';

export type VeniceChatPrompt = Array<VeniceMessage>;
export type VeniceMessage = VeniceSystemMessage | VeniceUserMessage | VeniceAssistantMessage | VeniceToolMessage;

export type VeniceContentPartText = { type: 'text'; text: string };
export type VeniceContentPartImage = { type: 'image_url'; image_url: { url: string } };
export type VeniceUserMessageContentPart = VeniceContentPartText | VeniceContentPartImage;

// Allow for arbitrary additional properties for general purpose
// provider-metadata-specific extensibility.
type JsonRecord<T = never> = Record<string, JSONValue | JSONValue[] | T | T[] | undefined>;

export interface VeniceSystemMessage extends JsonRecord<VeniceContentPartText> {
    role: 'system';
    content: string | Array<VeniceContentPartText>;
}

export interface VeniceUserMessage extends JsonRecord<VeniceContentPartText | VeniceContentPartImage> {
    role: 'user';
    content: string | Array<VeniceUserMessageContentPart>;
}
export interface VeniceAssistantMessage extends JsonRecord<VeniceContentPartText | VeniceMessageToolCall> {
    role: 'assistant';
    tool_calls?: Array<VeniceMessageToolCall>;
    reasoning_content?: string;
    content: string | Array<VeniceContentPartText>;
}

export interface VeniceToolMessage extends JsonRecord<VeniceContentPartText> {
    role: 'tool';
    tool_call_id: string;
    content: string | Array<VeniceContentPartText>;
}

export type VeniceMessageToolCall = {
    type: 'function';
    id: string;
    function: {
        arguments: string;
        name: string;
    };
};
