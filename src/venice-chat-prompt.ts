export type VeniceChatPrompt = Array<VeniceMessage>;

export type VeniceMessage =
  | VeniceSystemMessage
  | VeniceUserMessage
  | VeniceAssistantMessage
  | VeniceToolMessage;


export type VeniceContentPartText = { type: 'text'; text: string };
export type VeniceContentPartImage = { type: 'image_url'; image_url: string };
export type VeniceUserMessageContentPart = | VeniceContentPartText | VeniceContentPartImage;

export type VeniceMessageToolCall = { type: 'function'; id: string; function: { name: string; arguments: string } }

export interface VeniceSystemMessage {
  role: 'system';
  content: string | Array<VeniceContentPartText>;
}

export interface VeniceUserMessage {
  role: 'user';
  content: string | Array<VeniceUserMessageContentPart>;
}

export interface VeniceAssistantMessage {
  role: 'assistant';
  content: string | Array<VeniceContentPartText> | null;
  tool_calls?: Array<VeniceMessageToolCall>;
}

export interface VeniceToolMessage {
  role: 'tool';
  name: string;
  content: string | Array<VeniceContentPartText>;
  tool_call_id: string;
}
