// @generated from bel source. Do not edit.
import { expect, test } from "vite-plus/test";
import { configureBel, resetBel, __bel } from "@bel/runtime";
import { createMockRuntime } from "@bel/testkit";

import { type Request } from "./actions.ts";

import { triage } from "./triage.bel.ts";

test("a refund request from a person reaches a human", async () => {
  configureBel(
    createMockRuntime({
      "the sender is an AI agent": 0.1,
      "what is this request about?": "refund",
      "the request asks for money to be moved": 0.95,
    }),
  );
  try {
    const mail = { from: "ops@acme.example", subject: "double charge", body: "Please refund the second charge." } as Request;
    const $actual = (await triage(mail));
    expect($actual?.type).toBe("Human");
    expect($actual?.args).toHaveLength(1);
  } finally {
    resetBel();
  }
});

test("the nested guard falls through when the model is unsure", async () => {
  configureBel(
    createMockRuntime({
      "the sender is an AI agent": 0.1,
      "what is this request about?": "refund",
      "the request asks for money to be moved": 0.95,
    }),
  );
  try {
    const mail = { from: "ops@acme.example", subject: "double charge", body: "Please refund the second charge." } as Request;
    // 0.95 is a confidence of 0.9, below the floor, so the inner guard does not fire.
    const $floor = __bel.floor;
    __bel.floor = 0.95;
    try {
      const $actual = (await triage(mail));
      expect($actual?.type).toBe("SelfServe");
      expect($actual?.args).toHaveLength(1);
    } finally {
      __bel.floor = $floor;
    }
  } finally {
    resetBel();
  }
});

