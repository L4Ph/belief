// @generated from bel source. Do not edit.
import { expect, test } from "vite-plus/test";
import { configureBel, resetBel } from "@bel/runtime";
import { createMockRuntime, createCassetteRuntime } from "@bel/testkit";

import { type Lead } from "./actions.ts";

import { rate } from "./leads.bel.ts";

test("a good fit that asked about pricing is pursued", async () => {
  configureBel(
    createMockRuntime({
      "how well does this lead match the ideal customer?": 3,
      "the lead has asked about pricing": 0.9,
    }),
  );
  try {
    const lead = { company: "Acme", employees: 240, source: "pricing page" } as Lead;
    const $actual = (await rate(lead));
    expect($actual?.type).toBe("Pursue");
    expect($actual?.args).toHaveLength(1);
  } finally {
    resetBel();
  }
});

test("a real answer, recorded once", async () => {
  configureBel(
    createCassetteRuntime({ path: new URL("cassettes/leads.v1.json", import.meta.url) }),
  );
  try {
    const lead = { company: "Acme", employees: 240, source: "pricing page" } as Lead;
    const $actual = (await rate(lead));
    expect($actual).not.toBeUndefined();
  } finally {
    resetBel();
  }
});

