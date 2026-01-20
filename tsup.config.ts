import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        sourcemap: true,
        outDir: 'dist',
        external: ['@ai-sdk/provider', '@ai-sdk/provider-utils', '@ai-sdk/openai-compatible'],
        define: {
            __PACKAGE_VERSION__: JSON.stringify((await import('./package.json', { with: { type: 'json' } })).default.version),
        },
    },
]);
