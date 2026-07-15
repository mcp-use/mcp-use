import { describe, expect, it } from "vitest";
import {
  answersToFormData,
  elicitationToAskUserQuestions,
} from "../elicitationToAskUserQuestions";

describe("elicitationToAskUserQuestions", () => {
  it("maps URL mode to a confirmation question", () => {
    const questions = elicitationToAskUserQuestions({
      mode: "url",
      message: "Authorize access",
      url: "https://example.com/oauth",
      elicitationId: "test-url",
    });

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe("__url_confirm__");
    expect(questions[0].options?.[0].id).toBe("confirmed");
  });

  it("maps primitive form fields to freeText questions", () => {
    const request = {
      mode: "form" as const,
      message: "Please provide your information",
      requestedSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", default: "Anonymous" },
          age: { type: "number", default: 0 },
        },
        required: ["name"],
      },
    };
    const questions = elicitationToAskUserQuestions(request);

    expect(questions.map((q) => q.id)).toEqual(["name", "age"]);
    expect(questions[0].freeText).toBe(true);
    expect(questions[0].skippable).toBe(false);
    expect(questions[1].skippable).toBe(true);
  });

  it("maps answers back to MCP form content", () => {
    const request = {
      mode: "form" as const,
      message: "Please provide your information",
      requestedSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          age: { type: "number" },
          verified: { type: "boolean" },
          status: { type: "string", enum: ["active", "inactive"] },
        },
        required: ["name"],
      },
    };

    const questions = elicitationToAskUserQuestions(request);
    const content = answersToFormData(
      questions,
      {
        name: {
          questionId: "name",
          selectedIds: [],
          otherText: "TestUser",
        },
        age: {
          questionId: "age",
          selectedIds: [],
          otherText: "25",
        },
        verified: {
          questionId: "verified",
          selectedIds: ["true"],
        },
        status: {
          questionId: "status",
          selectedIds: ["active"],
        },
      },
      request
    );

    expect(content).toEqual({
      name: "TestUser",
      age: 25,
      verified: true,
      status: "active",
    });
  });
});
