import { describe, it, expect } from "vitest";
import { toLearnerQuiz } from "../quiz.server";
import { QuestionType } from "~/db/schema";

const quizWithAnswers = {
  id: 7,
  lessonId: 3,
  title: "TypeScript Basics Quiz",
  passingScore: 0.7,
  questions: [
    {
      id: 11,
      quizId: 7,
      questionText: "What does TypeScript compile to?",
      questionType: QuestionType.MultipleChoice,
      position: 1,
      options: [
        { id: 21, questionId: 11, optionText: "JavaScript", isCorrect: true },
        { id: 22, questionId: 11, optionText: "Java", isCorrect: false },
      ],
    },
  ],
};

describe("toLearnerQuiz", () => {
  it("keeps what the learner needs to answer the quiz", () => {
    expect(toLearnerQuiz(quizWithAnswers)).toEqual({
      id: 7,
      title: "TypeScript Basics Quiz",
      passingScore: 0.7,
      questions: [
        {
          id: 11,
          questionText: "What does TypeScript compile to?",
          questionType: QuestionType.MultipleChoice,
          position: 1,
          options: [
            { id: 21, optionText: "JavaScript" },
            { id: 22, optionText: "Java" },
          ],
        },
      ],
    });
  });

  it("never sends which option is correct to the browser", () => {
    expect(JSON.stringify(toLearnerQuiz(quizWithAnswers))).not.toContain(
      "isCorrect"
    );
  });
});
