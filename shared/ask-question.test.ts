import { describe, expect, it } from "vitest";
import { parseHarnessQuestions, validateQuestionAnswers, legacyQuestionAnswer, parseChoices } from "./ask-question";

const raw = [
  { id: "one", question: "请选择", detail: "完整计划\n第二段", intent: { kind: "plan-review" }, options: [{ label: "Allow", description: "仅业务选项" }, { label: "甲,乙\n丙" }] },
  { id: "two", question: "请选择", multiSelect: true, options: [{ label: "A" }, { label: "B" }] },
];
describe("Harness native questions", () => {
  it("preserves IDs, identical question texts, detail and exact option labels", () => {
    expect(parseHarnessQuestions(raw)).toEqual(raw);
  });
  it("accepts distinct selected/custom answers in request order", () => {
    const questions = parseHarnessQuestions(raw)!;
    const answers = [{ id: "one", selected: ["甲,乙\n丙"] }, { id: "two", selected: ["A", "B"], custom: "备注" }];
    expect(validateQuestionAnswers(questions, answers)).toEqual(answers);
    expect(legacyQuestionAnswer(questions, "Allow")).toBeNull();
    expect(legacyQuestionAnswer([questions[0]!], "Allow")).toEqual([{ id: "one", selected: ["Allow"] }]);
  });
  it.each([
    [{ id: "one", selected: ["unknown"] }, { id: "two", selected: [] }],
    [{ id: "two", selected: [] }, { id: "one", selected: [] }],
    [{ id: "one", selected: ["Allow"], custom: "mixed" }, { id: "two", selected: [] }],
    [{ id: "one", selected: [] }, { id: "two", selected: ["A", "A"] }],
    [{ id: "one", selected: [] }],
  ])("rejects wrong labels, positions, mixed single selection or incomplete batches", (...answers) => {
    expect(validateQuestionAnswers(parseHarnessQuestions(raw)!, answers)).toBeNull();
  });
  it("does not silently truncate oversized batches or duplicate IDs", () => {
    expect(parseHarnessQuestions([...raw, raw[0]])).toBeNull();
    expect(parseHarnessQuestions(Array.from({ length: 65 }, (_, i) => ({ ...raw[0], id: String(i) })))).toBeNull();
    expect(parseHarnessQuestions([{ ...raw[0], options: [{ label: "x".repeat(200) }] }])?.[0]?.options[0]?.label).toHaveLength(200);
  });
  it("legacy object choices cannot become React children", () => {
    expect(parseChoices([{ label: "Allow" }, null, 12, { unexpected: true }, "其他"])).toEqual(["Allow", "其他"]);
  });
});
