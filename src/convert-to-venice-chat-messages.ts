import type {
  LanguageModelV3Prompt,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import type { VeniceChatPrompt, VeniceContentPartText } from './venice-chat-prompt';
import { convertToBase64 } from '@ai-sdk/provider-utils';

function getVeniceMetadata(message: { providerOptions?: SharedV3ProviderMetadata }) {
  return message?.providerOptions?.venice ?? message?.providerOptions?.openaiCompatible ?? {};
}

export function convertToVeniceChatMessages(prompt: LanguageModelV3Prompt): VeniceChatPrompt {
  const messages: VeniceChatPrompt = [];
  for (const { role, content, providerOptions } of prompt) {
    switch (role) {
      case 'system': {
        messages.push({
          role: 'system',
          content: [{ type: 'text', text: content, ...getVeniceMetadata({ providerOptions }) }]
        });
        break;
      }

      case 'user': {
        if (content.length === 1 && content[0]?.type === 'text') {
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: content[0].text }],
            ...getVeniceMetadata(content[0]),
          });
          break;
        }

        messages.push({
          role: 'user',
          content: content.map(part => {
            switch (part.type) {
              case 'text': {
                return { type: 'text', text: part.text };
              }
              case 'file': {
                if (part.mediaType.startsWith('image/')) {
                  const mediaType =
                    part.mediaType === 'image/*'
                      ? 'image/jpeg'
                      : part.mediaType;

                  return {
                    type: 'image_url',
                    image_url:
                      part.data instanceof URL
                        ? part.data.toString()
                        : `data:${mediaType};base64,${convertToBase64(part.data)}`,
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
        let assistantText = '';
        const toolCalls: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }> = [];

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              assistantText += part.text;
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
          }
        }

        messages.push({
          role: 'assistant',
          content: assistantText ? [{ type: 'text', text: assistantText }] : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          ...getVeniceMetadata({ providerOptions }),
        });

        break;
      }

      case 'tool': {
        for (const toolResponse of content) {
          if (toolResponse.type === 'tool-approval-response') {
            continue;
          }

          const output = toolResponse.output;

          let contentValue: string | Array<VeniceContentPartText>;
          switch (output.type) {
            case 'text':
              contentValue = [{ type: 'text', text: output.value }];
              break;
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
          }

          messages.push({
            role: 'tool',
            name: toolResponse.toolName,
            content: contentValue,
            tool_call_id: toolResponse.toolCallId,
            ...getVeniceMetadata(toolResponse),
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