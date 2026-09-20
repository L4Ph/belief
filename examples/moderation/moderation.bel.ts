// @generated from bel source. Do not edit.
import { __bel } from "@bel/runtime";

import { allow, remove, review, type Action, type Post } from "./actions.ts"

export async function moderate(p: Post): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: "0", type: "choice", text: "what is this post doing?", rubric: ["spam", "abuse", "question", "praise"] },
      { id: "1", type: "noul", text: "the post is on topic and civil" },
    ],
    p,
  );
  if (__bel.det($b[0].value == "abuse") >= 0.5) {
    __bel.mark("moderate", 0);
    return remove(p, "harassment");
  }
  if (__bel.det($b[0].value == "spam") >= 0.5) {
    __bel.mark("moderate", 1);
    return remove(p, "spam");
  }
  if (__bel.number($b[1]) >= 0.8) {
    __bel.mark("moderate", 2);
    return allow(p);
  }
  __bel.mark("moderate", 3);
  return review(p);
}
