// @generated from bel source. Do not edit.
import { __bel } from "@bel/runtime";

import { agent, human, selfServe, type Action, type Request } from "./actions.ts"

export async function triage(r: Request): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: "0", type: "choice", text: "what is this request about?", rubric: ["refund", "integration", "bug", "question"] },
      { id: "1", type: "noul", text: "the sender is an AI agent" },
      { id: "2", type: "noul", text: "the request asks for money to be moved" },
    ],
    r,
  );
  if (__bel.number($b[1]) >= 0.5) {
    __bel.mark("triage", 0);
    return agent(r);
  }
  if (__bel.det($b[0].value == "refund") >= 0.5) {
    __bel.mark("triage", 1);
    if (__bel.number($b[2]) >= 0.9) {
      return human(r);
    }
    return selfServe(r);
  }
  if (__bel.det($b[0].value == "integration") >= 0.5) {
    __bel.mark("triage", 2);
    return selfServe(r);
  }
  __bel.mark("triage", 3);
  return human(r);
}
