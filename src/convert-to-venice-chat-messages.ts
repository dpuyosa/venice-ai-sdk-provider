import type { LanguageModelV4Prompt, SharedV4FileData, SharedV4ProviderMetadata } from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';

import { convertToBase64, detectMediaType, getTopLevelMediaType, isFullMediaType, secureJsonParse, stringifyWithBigIntAndCycles } from '@ai-sdk/provider-utils';
import type {
    VeniceChatPrompt,
    VeniceContentPartAudio,
    VeniceContentPartFile,
    VeniceContentPartImage,
    VeniceContentPartVideo,
    VeniceImageDetail,
    VeniceMessageToolCall,
    VeniceReasoningDetail,
    VeniceUserMessageContentPart,
} from './venice-chat-message';

const REASONING_METADATA_KEYS = ['thoughtSignature', 'thought_signature', 'reasoningDetails', 'reasoning_details', 'reasoningEncrypted', 'reasoning_encrypted'];

type ResolvedFileData = { data: Uint8Array | string | URL; mediaType: string };

function normalizeCacheControl(metadata: Record<string, unknown>): Record<string, unknown> {
    const { cacheControl, ...rest } = metadata;
    return cacheControl == null || 'cache_control' in rest ? rest : { ...rest, cache_control: cacheControl };
}

function getVeniceMetadata(message: { providerOptions?: SharedV4ProviderMetadata }, providerOptionsName = 'venice') {
    const openaiCompatible = normalizeCacheControl((message?.providerOptions?.openaiCompatible ?? {}) as Record<string, unknown>);
    const venice = normalizeCacheControl((message?.providerOptions?.[providerOptionsName] ?? {}) as Record<string, unknown>);
    return { ...openaiCompatible, ...venice };
}

function readReasoningDetails(metadata: Record<string, unknown>): VeniceReasoningDetail[] {
    const details = metadata.reasoningDetails ?? metadata.reasoning_details;
    return Array.isArray(details) ? (details as VeniceReasoningDetail[]) : [];
}

function readThoughtSignature(metadata: Record<string, unknown>): string | undefined {
    const signature = metadata.thoughtSignature ?? metadata.thought_signature;
    return typeof signature === 'string' && signature.length > 0 ? signature : undefined;
}

function omitReasoningMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(metadata).filter(([key]) => !REASONING_METADATA_KEYS.includes(key)));
}

function serializeToolCallArguments(input: unknown): string {
    if (typeof input === 'string') {
        try {
            secureJsonParse(input);
            return input;
        } catch {
            return JSON.stringify(input);
        }
    }
    return stringifyWithBigIntAndCycles(input);
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
        'audio/pcm24': 'pcm24',
    };
    const format = formatMap[mimeType.toLowerCase()];
    if (format == null) {
        throw new UnsupportedFunctionalityError({ functionality: `audio media type ${mimeType}` });
    }
    return format;
}

function isClaudeModel(modelId: string): boolean {
    return modelId.toLowerCase().includes('claude');
}

function isVeniceImageDetail(value: unknown): value is VeniceImageDetail {
    return value === 'auto' || value === 'low' || value === 'high' || value === 'original';
}

function resolveMediaType(mediaType: string, data: ResolvedFileData['data']): string {
    if (isFullMediaType(mediaType)) return mediaType;

    const topLevelType = getTopLevelMediaType(mediaType);
    const detected = data instanceof URL ? undefined : detectMediaType({ data, topLevelType });
    if (detected != null && isFullMediaType(detected)) return detected;

    switch (topLevelType) {
        case 'image':
            return 'image/jpeg';
        case 'video':
            return 'video/mp4';
        case 'audio':
            return 'audio/mpeg';
        default:
            return 'application/octet-stream';
    }
}

function resolveFileData(fileData: SharedV4FileData, mediaType: string): ResolvedFileData {
    if (fileData.type === 'reference') {
        throw new UnsupportedFunctionalityError({
            functionality: 'provider file references',
            message: 'Venice does not support provider file references.',
        });
    }

    if (fileData.type === 'text') {
        return {
            data: new TextEncoder().encode(fileData.text),
            mediaType: isFullMediaType(mediaType) ? mediaType : 'text/plain',
        };
    }

    const data = fileData.type === 'url' ? fileData.url : fileData.data;
    return { data, mediaType: resolveMediaType(mediaType, data) };
}

function createImageContentPart(resolved: ResolvedFileData, partMetadata?: object): VeniceContentPartImage & object {
    const { data, mediaType } = resolved;
    if (data instanceof URL && data.protocol !== 'http:' && data.protocol !== 'https:') {
        throw new UnsupportedFunctionalityError({ functionality: `file URL protocol ${data.protocol}` });
    }
    const restMetadata: Record<string, unknown> = { ...(partMetadata ?? {}) };
    const rawDetail = restMetadata.imageDetail ?? restMetadata.detail;
    delete restMetadata.imageDetail;
    delete restMetadata.detail;
    return {
        type: 'image_url',
        image_url: {
            url: data instanceof URL ? data.toString() : `data:${mediaType};base64,${convertToBase64(data)}`,
            ...(isVeniceImageDetail(rawDetail) ? { detail: rawDetail } : {}),
        },
        ...restMetadata,
    };
}

function createVideoContentPart(resolved: ResolvedFileData, partMetadata?: object): VeniceContentPartVideo & object {
    const { data, mediaType } = resolved;
    const mimeType = mediaType.toLowerCase();
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

function createAudioContentPart(resolved: ResolvedFileData, partMetadata?: object): VeniceContentPartAudio & object {
    const { data, mediaType } = resolved;
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

function createFileContentPart(resolved: ResolvedFileData, filename?: string, partMetadata?: object): VeniceContentPartFile & object {
    const { data, mediaType } = resolved;
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

function createFilePartContent(part: { data: SharedV4FileData; mediaType: string; filename?: string }, partMetadata: object): VeniceUserMessageContentPart {
    const resolved = resolveFileData(part.data, part.mediaType);
    switch (getTopLevelMediaType(resolved.mediaType)) {
        case 'image':
            return createImageContentPart(resolved, partMetadata);
        case 'audio':
            return createAudioContentPart(resolved, partMetadata);
        case 'video':
            return createVideoContentPart(resolved, partMetadata);
        default:
            return createFileContentPart(resolved, part.filename, partMetadata);
    }
}

export function convertToVeniceChatMessages(prompt: LanguageModelV4Prompt, modelId: string, providerOptionsName = 'venice'): VeniceChatPrompt {
    // Claude prompt caching needs cache_control on content blocks, so Claude messages (including tool messages) always use block arrays.
    const forceContentArray = isClaudeModel(modelId);
    const messages: VeniceChatPrompt = [];
    for (const { role, content, providerOptions } of prompt) {
        switch (role) {
            case 'system': {
                const partMetadata = getVeniceMetadata({ providerOptions }, providerOptionsName);
                messages.push({
                    role: 'system',
                    content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: content, ...partMetadata }] : content,
                });
                break;
            }

            case 'user': {
                if (content.length === 1 && content[0]?.type === 'text') {
                    const partMetadata = getVeniceMetadata(content[0], providerOptionsName);
                    messages.push({
                        role: 'user',
                        content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: content[0].text, ...partMetadata }] : content[0].text,
                        ...getVeniceMetadata({ providerOptions }, providerOptionsName),
                    });
                    break;
                }

                messages.push({
                    role: 'user',
                    content: content.map((part) => {
                        const partMetadata = getVeniceMetadata(part, providerOptionsName);
                        switch (part.type) {
                            case 'text': {
                                return { type: 'text', text: part.text, ...partMetadata };
                            }
                            case 'file': {
                                return createFilePartContent(part, partMetadata);
                            }
                            default: {
                                throw new UnsupportedFunctionalityError({
                                    functionality: `content part type ${(part as { type: string }).type}`,
                                });
                            }
                        }
                    }),
                    ...getVeniceMetadata({ providerOptions }, providerOptionsName),
                });
                break;
            }

            case 'assistant': {
                let assistantText = '';
                let reasoningText = '';
                let messageThoughtSignature: string | undefined;
                const assistantMetadata = {};
                const reasoningDetails: VeniceReasoningDetail[] = [];
                const toolCalls: VeniceMessageToolCall[] = [];

                for (const part of content) {
                    const partMetadata = getVeniceMetadata(part, providerOptionsName);
                    switch (part.type) {
                        case 'text': {
                            assistantText += part.text;
                            Object.assign(assistantMetadata, partMetadata);
                            break;
                        }
                        case 'reasoning': {
                            reasoningText += part.text;
                            reasoningDetails.push(...readReasoningDetails(partMetadata));
                            messageThoughtSignature = readThoughtSignature(partMetadata) ?? messageThoughtSignature;
                            break;
                        }
                        case 'tool-call': {
                            const thoughtSignature = readThoughtSignature(partMetadata) ?? readThoughtSignature(part.providerOptions?.google ?? {});
                            reasoningDetails.push(...readReasoningDetails(partMetadata));
                            toolCalls.push({
                                id: part.toolCallId,
                                type: 'function',
                                function: {
                                    name: part.toolName,
                                    arguments: serializeToolCallArguments(part.input),
                                },
                                ...(thoughtSignature == null ? {} : { thought_signature: thoughtSignature }),
                                ...omitReasoningMetadata(partMetadata),
                            });
                            break;
                        }
                        case 'file': {
                            throw new UnsupportedFunctionalityError({
                                functionality: 'assistant file content',
                            });
                        }
                        // Venice has no wire representation for these assistant part types.
                        case 'custom':
                        case 'reasoning-file':
                        case 'tool-result': {
                            break;
                        }
                        default: {
                            throw new UnsupportedFunctionalityError({
                                functionality: `assistant content part type ${(part as { type: string }).type}`,
                            });
                        }
                    }
                }

                const messageMetadata = getVeniceMetadata({ providerOptions }, providerOptionsName);
                reasoningDetails.push(...readReasoningDetails(messageMetadata));
                messageThoughtSignature = readThoughtSignature(messageMetadata) ?? messageThoughtSignature;

                if (!(assistantText.length || toolCalls.length || reasoningText.length || reasoningDetails.length || messageThoughtSignature != null)) break;
                // Anthropic cannot cache empty text blocks, so tool-only turns get "\n" instead of null/''.
                if (!assistantText.length) assistantText = '\n';

                messages.push({
                    role: 'assistant',
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    reasoning_content: reasoningText.length > 0 ? reasoningText : undefined,
                    reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined,
                    ...(messageThoughtSignature == null ? {} : { thought_signature: messageThoughtSignature }),
                    content: forceContentArray || Object.keys(assistantMetadata).length > 0 ? [{ type: 'text', text: assistantText, ...assistantMetadata }] : assistantText,
                    ...omitReasoningMetadata(messageMetadata),
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

                    const partMetadata = getVeniceMetadata(toolResponse, providerOptionsName);
                    const output = toolResponse.output;

                    // Check if output contains media (only possible with 'content' type)
                    if (output.type === 'content' && mediaUserContent.length < 20) {
                        const hasMedia = output.value.some((part) => part.type === 'file');

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
                                if (part.type === 'file') {
                                    mediaParts.push(createFilePartContent(part, getVeniceMetadata(part, providerOptionsName)));
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
                                    ...getVeniceMetadata({ providerOptions }, providerOptionsName),
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
                            contentValue = stringifyWithBigIntAndCycles(output.value);
                            break;
                        default:
                            contentValue = '';
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolResponse.toolCallId,
                        content: forceContentArray || Object.keys(partMetadata).length > 0 ? [{ type: 'text', text: contentValue, ...partMetadata }] : contentValue,
                        ...getVeniceMetadata({ providerOptions }, providerOptionsName),
                    });
                }

                // Push single combined user message AFTER all non-media tool messages
                if (mediaUserContent.length > 0) {
                    messages.push({
                        role: 'user',
                        content: mediaUserContent,
                        ...getVeniceMetadata({ providerOptions }, providerOptionsName),
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
