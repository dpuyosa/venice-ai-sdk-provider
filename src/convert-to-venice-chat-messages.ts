import type { LanguageModelV2Prompt, SharedV2ProviderMetadata } from '@ai-sdk/provider';

import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { VeniceChatPrompt } from './venice-chat-parts';
import { convertToBase64 } from '@ai-sdk/provider-utils';

function getVeniceMetadata(message: { providerOptions?: SharedV2ProviderMetadata }) {
    return message?.providerOptions?.venice ?? message?.providerOptions?.openaiCompatible ?? {};
}

export function convertToVeniceChatMessages(prompt: LanguageModelV2Prompt): VeniceChatPrompt {
    const messages: VeniceChatPrompt = [];
    for (const { role, content, ...message } of prompt) {
        const metadata = getVeniceMetadata({ ...message });
        switch (role) {
            case 'system': {
                messages.push({ role: 'system', content, ...metadata });
                break;
            }

            case 'user': {
                if (content.length === 1 && content[0]?.type === 'text') {
                    messages.push({
                        role: 'user',
                        content: content[0].text,
                        ...getVeniceMetadata(content[0]),
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
                                    const mediaType = part.mediaType === 'image/*' ? 'image/jpeg' : part.mediaType;

                                    return {
                                        type: 'image_url',
                                        image_url: {
                                            url: part.data instanceof URL ? part.data.toString() : `data:${mediaType};base64,${convertToBase64(part.data)}`,
                                        },
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
                    ...metadata,
                });

                break;
            }

            case 'assistant': {
                let text = '';
                const toolCalls: Array<{
                    id: string;
                    type: 'function';
                    function: { name: string; arguments: string };
                }> = [];

                for (const part of content) {
                    const partMetadata = getVeniceMetadata(part);
                    switch (part.type) {
                        case 'text': {
                            text += part.text;
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
                    }
                }

                messages.push({
                    role: 'assistant',
                    content: text,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    ...metadata,
                });

                break;
            }

            case 'tool': {
                for (const toolResponse of content) {
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

                    const toolResponseMetadata = getVeniceMetadata(toolResponse);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolResponse.toolCallId,
                        content: contentValue,
                        ...toolResponseMetadata,
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
