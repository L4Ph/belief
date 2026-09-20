import { trace } from "@bel/runtime";
import { moderate } from "./moderation.bel.ts";

const post = { body: "This is the third time I have had to ask. Absolutely useless." };

console.log(await moderate(post));
console.log(trace().at(-1));
