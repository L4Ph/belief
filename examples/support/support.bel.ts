// @generated from bel source. Do not edit.
import { __bel } from "@bel/runtime";

import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

export async function support(t: Ticket): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: "0", type: "score", text: "how urgent is this request?", rubric: ["low", "medium", "high", "human"] },
      { id: "1", type: "noul", text: "the customer is angry" },
      { id: "2", type: "noul", text: "the customer asks for a refund" },
    ],
    t,
  );
  if (__bel.det(__bel.number($b[0]) >= 2) >= 0.5) {
    __bel.mark("support", 0);
    return escalate(t);
  }
  if (__bel.composeAnd($b[1], $b[2]) >= 0.7) {
    __bel.mark("support", 1);
    return refund(t);
  }
  __bel.mark("support", 2);
  return reply("could you tell me more about the order?");
}
