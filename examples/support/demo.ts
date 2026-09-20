/**
 * Ask the flow about a message and show why it decided what it did.
 *
 * The interesting part of bel is not the branch — it is that the branch is a
 * threshold over model output. This prints what the model was asked, what it
 * answered, and which guard that answer reached.
 *
 *   vp run demo "I want a refund for the duplicate charge"
 */
import { __bel, trace } from "@bel/runtime";
import { support } from "./support.bel.ts";

const message =
  process.argv.slice(2).join(" ") ||
  "I was charged twice for my subscription last month and I want my money back right now.";

const action = await support({ message });
const last = trace().at(-1);
if (last === undefined) throw new Error("no trace: did the flow run?");

const value = Object.fromEntries(last.evaluations.map((e) => [e.text, e.value]));

console.log(`message  ${message}\n`);
console.log("the model was asked once, for all of these:");
for (const evaluation of last.evaluations) {
  const shown =
    typeof evaluation.value === "number" ? evaluation.value.toFixed(2) : evaluation.value;
  console.log(
    `  ${shown.padStart(5)}  confidence ${evaluation.confidence.toFixed(2)}  ${evaluation.text}`,
  );
}

// The guards below are the ones in support.bel, in order, spelled out so the
// decision can be read rather than inferred from the trace alone.
const urgency = Number(value["how urgent is this request?"]);
const angry = Number(value["the customer is angry"]);
const refund = Number(value["the customer asks for a refund"]);
const guards: [string, boolean, string][] = [
  ["urgency >= high", urgency >= 2, `level ${urgency} of low | medium | high | human`],
  [
    "angry & refund @ 0.7",
    __bel.composeAnd(angry, refund) >= 0.7,
    `${angry} × ${refund} = ${(angry * refund).toFixed(2)}`,
  ],
  ["_", true, "the fallback"],
];

console.log("\nguards are read top to bottom, and the first one over its threshold wins:");
guards.forEach(([condition, holds, why], index) => {
  const taken = index === last.takenGuard;
  console.log(
    `  ${taken ? "→" : " "} ${condition.padEnd(22)} ${why.padEnd(28)} ${taken ? "FIRED" : holds ? "would also hold" : ""}`,
  );
});

console.log(`\n=> ${JSON.stringify(action)}`);
