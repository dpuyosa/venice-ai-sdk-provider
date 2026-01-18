import type { LanguageModelV2Prompt, SharedV2ProviderMetadata } from '@ai-sdk/provider';

import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { VeniceChatPrompt } from './venice-chat-message';
import { convertToBase64 } from '@ai-sdk/provider-utils';
import { meta } from 'zod/v4/core';

function getVeniceMetadata(message: { providerOptions?: SharedV2ProviderMetadata }) {
    return message?.providerOptions?.venice ?? message?.providerOptions?.openaiCompatible ?? {};
}

export function convertToVeniceChatMessages(prompt: LanguageModelV2Prompt): VeniceChatPrompt {
    const messages: VeniceChatPrompt = [];
    for (const { role, content, providerOptions } of prompt) {
        switch (role) {
            case 'system': {
                const partMetadata = getVeniceMetadata({ providerOptions });
                messages.push({
                    role: 'system',
                    content: partMetadata ? [{ type: 'text', text: content, ...partMetadata }] : content,
                });
                break;
            }

            case 'user': {
                if (content.length === 1 && content[0]?.type === 'text') {
                    const partMetadata = getVeniceMetadata(content[0]);
                    messages.push({
                        role: 'user',
                        content: partMetadata ? [{ type: 'text', text: content[0].text, ...partMetadata }] : content[0].text,
                        ...getVeniceMetadata({ providerOptions }),
                    });
                    break;
                }

                messages.push({
                    role: 'user',
                    content: content.map((part) => {
                        const partMetadata = getVeniceMetadata(part);
                        switch (part.type) {
                            case 'text': {
                                return { type: 'text', text: part.text, ...partMetadata };
                            }
                            case 'file': {
                                if (part.mediaType.startsWith('image/')) {
                                    return {
                                        type: 'image_url',
                                        image_url: part.data instanceof URL ? part.data.toString() : `data:${part.mediaType};base64,${convertToBase64(part.data)}`,
                                        ...partMetadata,
                                    };
                                } else {
                                    throw new UnsupportedFunctionalityError({
                                        functionality: `file part media type ${part.mediaType}`,
                                    });
                                }
                            }
                        }
                    }),
                    ...getVeniceMetadata({ providerOptions }),
                });
                break;
            }

            case 'assistant': {
                if (content.length === 1 && content[0]?.type === 'text') {
                    const partMetadata = getVeniceMetadata(content[0]);
                    messages.push({
                        role: 'assistant',
                        content: partMetadata ? [{ type: 'text', text: content[0].text, ...partMetadata }] : content[0].text,
                        ...getVeniceMetadata({ providerOptions }),
                    });
                    break;
                }

                let assistantText = '';
                let assistantMetadata = {};
                const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

                for (const part of content) {
                    const partMetadata = getVeniceMetadata(part);
                    switch (part.type) {
                        case 'text': {
                            assistantText += part.text;
                            assistantMetadata = {
                                ...assistantMetadata,
                                ...partMetadata,
                            };
                            break;
                        }
                        case 'tool-call': {
                            toolCalls.push({
                                id: part.toolCallId,
                                type: 'function',
                                function: {
                                    name: part.toolName,
                                    arguments: JSON.stringify(part.input),
                                },
                                ...partMetadata,
                            });
                            break;
                        }
                        // case 'reasoning': { }
                    }
                }

                messages.push({
                    role: 'assistant',
                    content: Object.keys(assistantMetadata) || assistantText ? [{ type: 'text', text: assistantText, ...assistantMetadata }] : '',
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    ...getVeniceMetadata({ providerOptions }),
                });

                break;
            }

            case 'tool': {
                for (const toolResponse of content) {
                    const partMetadata = getVeniceMetadata(toolResponse);
                    const output = toolResponse.output;

                    let contentValue: string;
                    switch (output.type) {
                        case 'text':
                        case 'error-text':
                            contentValue = output.value;
                            break;
                        case 'content':
                        case 'json':
                        case 'error-json':
                            contentValue = JSON.stringify(output.value);
                            break;
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolResponse.toolCallId,
                        content: partMetadata ? [{ type: 'text', text: contentValue, ...partMetadata }] : contentValue,
                        ...getVeniceMetadata({ providerOptions }),
                    });
                }
                break;
            }

            default: {
                const _exhaustiveCheck: never = role;
                throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
            }
        }
    }

    return messages;
}
