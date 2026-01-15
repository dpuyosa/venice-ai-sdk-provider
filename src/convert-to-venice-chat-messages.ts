import type { LanguageModelV3Prompt, SharedV3ProviderMetadata } from "@ai-sdk/provider";
import type { VeniceChatPrompt } from "./venice-chat-prompt";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { convertToBase64 } from "@ai-sdk/provider-utils";

function getVeniceMetadata(message: { providerOptions?: SharedV3ProviderMetadata }) {
  return (message?.providerOptions?.venice ?? message?.providerOptions?.openaiCompatible ?? null);
}

export function convertToVeniceChatMessages(prompt: LanguageModelV3Prompt): VeniceChatPrompt {
  const messages: VeniceChatPrompt = [];
  for (const { role, content, providerOptions } of prompt) {
    switch (role) {
      case "system": {
        const metadata = getVeniceMetadata({ providerOptions });
        messages.push({
          role: "system",
          content: metadata
            ? [{ type: "text", text: content, ...metadata }]
            : content,
        });
        break;
      }

      case "user": {
        if (content.length === 1 && content[0]?.type === "text") {
          const partMetadata = getVeniceMetadata(content[0]);
          messages.push({
            role: "user",
            content: partMetadata
              ? [{ type: "text", text: content[0].text, ...partMetadata }]
              : content[0].text,
            ...getVeniceMetadata({ providerOptions }),
          });
          break;
        }

        messages.push({
          role: "user",
          content: content.map((part) => {
            const partMetadata = getVeniceMetadata(part);
            switch (part.type) {
              case "text": {
                return { type: "text", text: part.text, ...partMetadata };
              }
              case "file": {
                if (part.mediaType.startsWith("image/")) {
                  return {
                    type: "image_url",
                    image_url:
                      part.data instanceof URL
                        ? part.data.toString()
                        : `data:${part.mediaType};base64,${convertToBase64(part.data)}`,
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

      case "assistant": {
        if (content.length === 1 && content[0]?.type === "text") {
          const partMetadata = getVeniceMetadata(content[0]);
          messages.push({
            role: "assistant",
            content: partMetadata
              ? [{ type: "text", text: content[0].text, ...partMetadata }]
              : content[0].text,
            ...getVeniceMetadata({ providerOptions }),
          });
          break;
        }

        let assistantText = "";
        let assistantMetadata = {};
        const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

        for (const part of content) {
          switch (part.type) {
            case "text": {
              assistantText += part.text;
              assistantMetadata = {
                ...assistantMetadata,
                ...getVeniceMetadata(part),
              };
              break;
            }
            case "tool-call": {
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
                ...getVeniceMetadata(part),
              });
              break;
            }
            // case 'reasoning': { }
          }
        }

        messages.push({
          role: "assistant",
          content:
            Object.keys(assistantMetadata) || assistantText
              ? [{ type: "text", text: assistantText, ...assistantMetadata }]
              : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          ...getVeniceMetadata({ providerOptions }),
        });

        break;
      }

      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue;
          }

          const metadata = getVeniceMetadata(toolResponse);
          const output = toolResponse.output;

          let contentText: string;
          switch (output.type) {
            case "text":
            case "error-text":
              contentText = output.value;
              break;
            case "execution-denied":
              contentText = output.reason ?? "Tool execution denied.";
              break;
            case "content":
            case "json":
            case "error-json":
              contentText = JSON.stringify(output.value);
              break;
          }

          messages.push({
            role: "tool",
            name: toolResponse.toolName,
            content: metadata
              ? [{ type: "text", text: contentText, ...metadata }]
              : contentText,
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
