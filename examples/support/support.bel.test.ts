// @generated from bel source. Do not edit.
import { expect, test } from "vite-plus/test";
import { configureBel, resetBel, __bel } from "@bel/runtime";
import { createMockRuntime } from "@bel/testkit";

import { type Ticket } from "./actions.ts";

import { support } from "./support.bel.ts";

test("an angry refund request is refunded", async () => {
  configureBel(
    createMockRuntime({
      "how urgent is this request?": 1,
      "the customer is angry": 0.9,
      "the customer asks for a refund": 0.9,
    }),
  );
  try {
    const ticket = { message: "I want my money back" } as Ticket;
    const $actual = (await support(ticket));
    expect($actual?.type).toBe("Refund");
    expect($actual?.args).toHaveLength(1);
  } finally {
    resetBel();
  }
});

test("when the model is unsure, the ticket stays with the agent", async () => {
  configureBel(
    createMockRuntime({
      "how urgent is this request?": 1,
      "the customer is angry": 0.9,
      "the customer asks for a refund": 0.9,
    }),
  );
  try {
    const ticket = { message: "I want my money back" } as Ticket;
    // Both beliefs sit at 0.9, which is a confidence of 0.8; the floor is above it.
    const $floor = __bel.floor;
    __bel.floor = 0.85;
    try {
      const $actual = (await support(ticket));
      expect($actual?.type).toBe("Reply");
      expect($actual?.args).toHaveLength(1);
    } finally {
      __bel.floor = $floor;
    }
  } finally {
    resetBel();
  }
});

