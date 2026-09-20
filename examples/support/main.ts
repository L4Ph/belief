import { trace } from "@bel/runtime";
import { support } from "./support.bel.ts";

const ticket = {
  message: "I was charged twice for my subscription last month and I want my money back right now.",
};

const action = await support(ticket);
console.log(action);
console.log(trace().at(-1));
