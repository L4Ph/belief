import { trace } from "@bel/runtime";
import { triage } from "./triage.bel.ts";

const request = {
  from: "ops@acme.example",
  subject: "double charge",
  body: "We were billed twice this month. Please refund the second charge.",
};

console.log(await triage(request));
console.log(trace().at(-1));
