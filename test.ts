// inspect-exports.ts
import * as mod from '@ai-sdk/openai-compatible';
import * as mod2 from '@ai-sdk/openai-compatible/internal';

console.log(Object.keys(mod)); // ["a", "b", "fn", "default"] in most setups
console.log(Object.keys(mod2)); // ["a", "b", "fn", "default"] in most setups
