// @generated from bel source. Do not edit.
import { expect, test } from "vite-plus/test";
import { configureBel, resetBel, __bel } from "@bel/runtime";
import { createMockRuntime } from "@bel/testkit";

import { type Post } from "./actions.ts";

import { moderate } from "./moderation.bel.ts";

test("a civil question goes through", async () => {
  configureBel(
    createMockRuntime({
      "what is this post doing?": "question",
      "the post is on topic and civil": 0.9,
    }),
  );
  try {
    const post = { body: "how do I export my data?" } as Post;
    const $actual = (await moderate(post));
    expect($actual?.type).toBe("Allow");
    expect($actual?.args).toHaveLength(1);
  } finally {
    resetBel();
  }
});

test("an unsure model sends it to a person", async () => {
  configureBel(
    createMockRuntime({
      "what is this post doing?": "question",
      "the post is on topic and civil": 0.9,
    }),
  );
  try {
    const post = { body: "how do I export my data?" } as Post;
    // 0.9 is a confidence of 0.8, below the floor; the belief stops holding.
    const $floor = __bel.floor;
    __bel.floor = 0.85;
    try {
      const $actual = (await moderate(post));
      expect($actual?.type).toBe("Review");
      expect($actual?.args).toHaveLength(1);
    } finally {
      __bel.floor = $floor;
    }
  } finally {
    resetBel();
  }
});

