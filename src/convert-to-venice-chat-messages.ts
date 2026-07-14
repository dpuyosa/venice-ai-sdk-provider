import type { LanguageModelV3DataContent, LanguageModelV3Prompt, SharedV3ProviderMetadata } from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';

import { convertToBase64 } from '@ai-sdk/provider-utils';
import type { VeniceChatPrompt, VeniceContentPartAudio, VeniceContentPartFile, VeniceContentPartImage, VeniceContentPartVideo, VeniceUserMessageContentPart } from './venice-chat-message';

function getVeniceMetadata(message: { providerOptions?: SharedV3ProviderMetadata }) {
    const openaiCompatible = message?.providerOptions?.openaiCompatible ?? {};
    const venice = message?.providerOptions?.venice ?? {};
    return { ...openaiCompatible, ...venice };
}

function extractAudioFormat(mimeType: string): 'wav' | 'mp3' | 'aiff' | 'aac' | 'ogg' | 'flac' | 'm4a' | 'pcm16' | 'pcm24' {
    const formatMap: Record<string, 'wav' | 'mp3' | 'aiff' | 'aac' | 'ogg' | 'flac' | 'm4a' | 'pcm16' | 'pcm24'> = {
        'audio/wav': 'wav',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/aiff': 'aiff',
        'audio/aac': 'aac',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
        'audio/m4a': 'm4a',
        'audio/pcm': 'pcm16',
    };
    return formatMap[mimeType.toLowerCase()] ?? 'wav';
}

function isClaudeModel(modelId: string): boolean {
    return modelId.toLowerCase().includes('claude');
}

function createImageContentPart(mediaType: string, data: LanguageModelV3DataContent, partMetadata?: object): VeniceContentPartImage & object {
    const finalMediaType = mediaType === 'image/*' ? 'image/jpeg' : mediaType;
    if (data instanceof URL && data.protocol !== 'http:' && data.protocol !== 'https:') {
        throw new UnsupportedFunctionalityError({ functionality: `file URL protocol ${data.protocol}` });
    }
    return {
        type: 'image_url',
        image_url: {
            url: data instanceof URL ? data.toString() : `data:${finalMediaType};base64,${convertToBase64(data)}`,
        },
        ...partMetadata,
    };
}

function createVideoContentPart(mediaType: string, data: LanguageModelV3DataContent, partMetadata?: object): VeniceContentPartVideo & object {
    const mimeType = mediaType === 'video/*' ? 'video/mp4' : mediaType.toLowerCase();
    const isValidVideo = ['video/mp4', 'video/mpeg', 'video/mov', 'video/webm'].includes(mimeType);

    if (!isValidVideo) {
        throw new UnsupportedFunctionalityError({
            functionality: `Unsupported video format: ${mediaType}`,
        });
    }
    if (data instanceof URL && data.protocol !== 'http:' && data.protocol !== 'https:') {
        throw new UnsupportedFunctionalityError({ functionality: `file URL protocol ${data.protocol}` });
    }

    return {
        type: 'video_url',
        video_url: {
            url: data instanceof URL ? data.toString() : `data:${mimeType};base64,${convertToBase64(data)}`,
        },
        ...partMetadata,
    };
}

function createAudioContentPart(mediaType: string, data: LanguageModelV3DataContent, partMetadata?: object): VeniceContentPartAudio & object {
    if (data instanceof URL) {
        throw new UnsupportedFunctionalityError({
            functionality: 'Audio URLs are not supported. Use base64-encoded audio data.',
        });
    }
    return {
        type: 'input_audio',
        input_audio: {
            data: convertToBase64(data),
            format: extractAudioFormat(mediaType),
        },
        ...partMetadata,
    };
}

function createFileContentPart(mediaType: string, data: LanguageModelV3DataContent, filename?: string, partMetadata?: object): VeniceContentPartFile & object {
    let fileData: string;
    if (data instanceof URL) {
        if (data.protocol !== 'http:' && data.protocol !== 'https:') {
            throw new UnsupportedFunctionalityError({ functionality: `file URL protocol ${data.protocol}` });
        }
        fileData = data.toString();
    } else {
        fileData = `data:${mediaType};base64,${convertToBase64(data)}`;
    }
    return {
        type: 'file',
        file: { file_data: fileData, ...(filename == null ? {} : { filename }) },
        ...partMetadata,
    };
}

export function convertToVeniceChatMessages(prompt: LanguageModelV3Prompt, modelId: string): VeniceChatPrompt {
    const forceContentArray = isClaudeModel(modelId);
    const messages: VeniceChatPrompt = [];
    for (const { role, content, providerOptions } of prompt) {
        switch (role) {
            case 'system': {
                const partMetadata = getVeniceMetadata({ providerOptions });
                messages.push({
                    role: 'system',
                    content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: content, ...partMetadata }] : content,
                });
                break;
            }

            case 'user': {
                if (content.length === 1 && content[0]?.type === 'text') {
                    const partMetadata = getVeniceMetadata(content[0]);
                    messages.push({
                        role: 'user',
                        content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: content[0].text, ...partMetadata }] : content[0].text,
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
                                    return createImageContentPart(part.mediaType, part.data, partMetadata);
                                } else if (part.mediaType.startsWith('audio/')) {
                                    return createAudioContentPart(part.mediaType, part.data, partMetadata);
                                } else if (part.mediaType.startsWith('video/')) {
                                    return createVideoContentPart(part.mediaType, part.data, partMetadata);
                                } else {
                                    return createFileContentPart(part.mediaType, part.data, part.filename, partMetadata);
                                }
                            }
                            default: {
                                throw new UnsupportedFunctionalityError({
                                    functionality: `content part type ${(part as { type: string }).type}`,
                                });
                            }
                        }
                    }),
                    ...getVeniceMetadata({ providerOptions }),
                });
                break;
            }

            case 'assistant': {
                let assistantText = '';
                let reasoningText = '';
                const assistantMetadata = {};
                const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

                for (const part of content) {
                    Object.assign(assistantMetadata, getVeniceMetadata(part));
                    switch (part.type) {
                        case 'text': {
                            assistantText += part.text;
                            break;
                        }
                        case 'reasoning': {
                            reasoningText += part.text;
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
                            });
                            break;
                        }
                        case 'file': {
                            throw new UnsupportedFunctionalityError({
                                functionality: 'assistant file content',
                            });
                        }
                    }
                }

                if (!(assistantText.length || toolCalls.length)) break;
                if (!assistantText.length) assistantText = '\n';

                messages.push({
                    role: 'assistant',
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    reasoning_content: reasoningText.length > 0 ? reasoningText : undefined,
                    content: forceContentArray || Object.keys(assistantMetadata).length > 0 ? [{ type: 'text', text: assistantText, ...assistantMetadata }] : assistantText,
                    ...getVeniceMetadata({ providerOptions }),
                });

                break;
            }

            case 'tool': {
                // Accumulator for ALL media-containing tool results
                const mediaUserContent: Array<VeniceUserMessageContentPart> = [];

                for (const toolResponse of content) {
                    // Skip tool approval responses (they don't have output)
                    if (toolResponse.type === 'tool-approval-response') {
                        continue;
                    }

                    const partMetadata = getVeniceMetadata(toolResponse);
                    const output = toolResponse.output;

                    // Check if output contains media (only possible with 'content' type)
                    if (output.type === 'content' && mediaUserContent.length < 20) {
                        const hasMedia = output.value.some((part) => ['image-data', 'image-url', 'file-data', 'file-url'].includes(part.type));

                        if (hasMedia) {
                            // Collect all text parts into a single string
                            const textParts = output.value.filter((part) => part.type === 'text').map((part) => part.text);
                            const textContent = textParts.length > 0 ? `[Tool Result: ${toolResponse.toolCallId}]\n${textParts.join('\n')}` : `[Tool Result: ${toolResponse.toolCallId}]`;

                            // Add single text part for this tool result
                            mediaUserContent.push({
                                type: 'text',
                                text: textContent,
                            });

                            // Collect all media parts for this tool result
                            const mediaParts: Array<VeniceUserMessageContentPart> = [];
                            for (const part of output.value) {
                                if (part.type === 'image-data') {
                                    mediaParts.push(createImageContentPart(part.mediaType, part.data));
                                } else if (part.type === 'image-url') {
                                    mediaParts.push(createImageContentPart('image/*', new URL(part.url)));
                                } else if (part.type === 'file-data') {
                                    if (part.mediaType?.startsWith('video/')) {
                                        mediaParts.push(createVideoContentPart(part.mediaType, part.data));
                                    } else if (part.mediaType?.startsWith('audio/')) {
                                        mediaParts.push(createAudioContentPart(part.mediaType, part.data));
                                    } else {
                                        mediaParts.push(createFileContentPart(part.mediaType, part.data, part.filename, getVeniceMetadata(part)));
                                    }
                                } else if (part.type === 'file-url') {
                                    const url = new URL(part.url);
                                    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                                        throw new UnsupportedFunctionalityError({ functionality: `file URL protocol ${url.protocol}` });
                                    } else if (url.pathname.match(/\.(mp4|mpeg|mov|webm)$/i)) {
                                        mediaParts.push(createVideoContentPart('video/*', url));
                                    } else {
                                        mediaParts.push(createFileContentPart('application/octet-stream', url, undefined, getVeniceMetadata(part)));
                                    }
                                }
                            }

                            // Apply partMetadata to last media part of this tool result
                            const lastMediaPart = mediaParts.at(-1);
                            if (lastMediaPart != null) {
                                Object.assign(lastMediaPart, partMetadata);
                                mediaUserContent.push(...mediaParts);

                                // Emit a tool message with text-only content for compatibility
                                const textOnlyContent = textParts.join('\n') || '\n';
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolResponse.toolCallId,
                                    content: textOnlyContent,
                                    ...getVeniceMetadata({ providerOptions }),
                                });

                                continue; // Skip creating individual tool message
                            }
                        }
                    }

                    // Default behavior: create tool message for non-media results
                    let contentValue: string;
                    switch (output.type) {
                        case 'text':
                        case 'error-text':
                            contentValue = output.value;
                            break;
                        case 'execution-denied':
                            contentValue = output.reason ?? 'Tool execution denied.';
                            break;
                        case 'content':
                        case 'json':
                        case 'error-json':
                            contentValue = JSON.stringify(output.value);
                            break;
                        default:
                            contentValue = '';
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolResponse.toolCallId,
                        content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: contentValue, ...partMetadata }] : contentValue,
                        ...getVeniceMetadata({ providerOptions }),
                    });
                }

                // Push single combined user message AFTER all non-media tool messages
                if (mediaUserContent.length > 0) {
                    messages.push({
                        role: 'user',
                        content: mediaUserContent,
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
