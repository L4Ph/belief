// @generated from bel source. Do not edit.
import { __bel } from "@bel/runtime";

import { disqualify, nurture, pursue, type Action, type Lead } from "./actions.ts"

export async function rate(l: Lead): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: "0", type: "score", text: "how well does this lead match the ideal customer?", rubric: ["none", "poor", "fair", "good", "ideal"] },
      { id: "1", type: "noul", text: "the lead has asked about pricing" },
    ],
    l,
  );
  if (__bel.composeAnd(__bel.det(__bel.number($b[0]) >= 3), $b[1]) >= 0.5) {
    __bel.mark("rate", 0);
    return pursue(l);
  }
  if (__bel.det(__bel.number($b[0]) >= 2) >= 0.5) {
    __bel.mark("rate", 1);
    return nurture(l);
  }
  __bel.mark("rate", 2);
  return disqualify(l);
}
