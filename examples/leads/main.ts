import { trace } from "@bel/runtime";
import { rate } from "./leads.bel.ts";

const lead = { company: "Acme", employees: 240, source: "a pricing page visit" };

console.log(await rate(lead));
console.log(trace().at(-1));
