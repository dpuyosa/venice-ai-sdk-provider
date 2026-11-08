import type { FetchFunction, FlexibleSchema, Resolvable } from '@ai-sdk/provider-utils';
import { combineHeaders, parseProviderOptions, resolve } from '@ai-sdk/provider-utils';

export interface VeniceModelConfig {
    provider: string;
    url: (options: { modelId: string; path: string }) => string;
    headers?: Resolvable<Record<string, string | undefined>>;
    fetch?: FetchFunction;
}

export function toCamelCase(name: string): string {
    return name.replace(/[_-]([a-z])/g, (_, char: string) => char.toUpperCase());
}

export async function resolveRequestHeaders(configHeaders: Resolvable<Record<string, string | undefined>> | undefined, callHeaders: Record<string, string | undefined> | undefined): Promise<Record<string, string | undefined>> {
    return combineHeaders(await resolve(configHeaders ?? {}), callHeaders);
}

/** Provider option keys in merge order, lowest to highest precedence. */
function getProviderOptionKeys(provider: string): string[] {
    const baseKey = provider.split('.')[0]?.trim() || 'venice';
    return ['openaiCompatible', baseKey, toCamelCase(baseKey)];
}

export function getModelProviderOptions(provider: string, providerOptions: Record<string, unknown> | undefined): Record<string, unknown> {
    return Object.assign({}, ...getProviderOptionKeys(provider).map((key) => providerOptions?.[key]));
}

export async function parseModelProviderOptions<OPTIONS>({
    provider,
    providerOptions,
    schema,
}: {
    provider: string;
    providerOptions: Record<string, unknown> | undefined;
    schema: FlexibleSchema<OPTIONS>;
}): Promise<OPTIONS | undefined> {
    const merged = {};
    for (const key of getProviderOptionKeys(provider)) {
        Object.assign(merged, await parseProviderOptions({ provider: key, providerOptions, schema }));
    }

    return Object.keys(merged).length > 0 ? (merged as OPTIONS) : undefined;
}
