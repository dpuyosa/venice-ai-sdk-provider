import { z } from 'zod/v4';
import { veniceParametersSchema } from './venice-chat-options';

/**
 * Converts camelCase string to snake_case at the type level.
 * Example: 'enableWebSearch' → 'enable_web_search'
 */
type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}` ? `${T extends Capitalize<T> ? '_' : ''}${Lowercase<T>}${CamelToSnakeCase<U>}` : S;

/**
 * Maps object keys from camelCase to snake_case.
 */
type KeysToSnakeCase<T> = {
    [K in keyof T as CamelToSnakeCase<K & string>]: T[K];
};

/**
 * Inferred from veniceParametersSchema in venice-chat-options.ts.
 * Do not manually edit - modify the Zod schema instead.
 */
type VeniceParametersInput = z.infer<typeof veniceParametersSchema>;

/**
 * Auto-generated from VeniceParametersInput with snake_case keys.
 * Do not manually edit - modify the Zod schema instead.
 */
type VeniceParametersOutput = KeysToSnakeCase<VeniceParametersInput>;

/**
 * Converts camelCase string to snake_case at runtime.
 * @internal
 */
function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function prepareVeniceParameters({ veniceParameters }: { veniceParameters: VeniceParametersInput | undefined }): VeniceParametersOutput | undefined {
    if (veniceParameters == null) {
        return undefined;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(veniceParameters)) {
        if (value !== undefined) {
            result[toSnakeCase(key)] = value;
        }
    }

    return Object.keys(result).length > 0 ? (result as VeniceParametersOutput) : undefined;
}
