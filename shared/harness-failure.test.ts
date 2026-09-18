import { expect, it } from "vitest";
import { harnessDenial } from "./harness-failure";

it.each([["AUTH", "authorization"], ["QUOTA", "quota"], ["HTTP_402", "payment"]])("routes structured %s without reading prose", (code, kind) => {
  expect(harnessDenial({ code, message: "arbitrary text" })).toEqual({ kind, code, retryable: false });
});
it("does not turn unknown text, rate limits or local USD budgets into enterprise quota", () => {
  expect(harnessDenial({ code: "UNKNOWN", message: "insufficient quota, balance 0" })).toBeUndefined();
  expect(harnessDenial({ code: "RATE_LIMIT", status: 429 })).toBeUndefined();
  expect(harnessDenial({ usdBudget: 0 })).toBeUndefined();
});
