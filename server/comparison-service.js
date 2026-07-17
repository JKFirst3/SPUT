import { summarizeQuestion } from "./analysis.js";

function normalized(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Creates side-by-side comparisons without merging or mutating source datasets. */
export class ComparisonService {
  compare(entries) {
    if (entries.length < 2) throw new Error("Bitte mindestens zwei Studien auswählen.");
    const questionKeys = new Map();
    for (const { dataset } of entries) {
      for (const question of dataset.questions.filter((item) => item.type !== "instruction")) {
        const key = `${question.position ?? question.number}:${normalized(question.label)}`;
        if (!questionKeys.has(key)) questionKeys.set(key, []);
        questionKeys.get(key).push({ dataset, question });
      }
    }
    const questions = [...questionKeys.values()]
      .filter((matches) => matches.length === entries.length)
      .map((matches) => ({
        label: matches[0].question.label,
        displayCode: matches[0].question.displayCode,
        type: matches[0].question.type,
        studies: matches.map(({ dataset, question }) => ({
          name: dataset.name,
          participants: dataset.participants,
          summary: summarizeQuestion(dataset, question),
        })),
      }));
    return {
      studies: entries.map(({ id, dataset }) => ({ id, name: dataset.name, participants: dataset.participants, countries: dataset.countries })),
      questions,
      unmatchedQuestionCount: entries.reduce((sum, { dataset }) => sum + dataset.questions.filter((q) => q.type !== "instruction").length, 0) - questions.length * entries.length,
    };
  }
}
