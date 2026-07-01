// Pure helpers for the branching survey: build the question tree, decide which
// questions are *applicable* given the current answers, and compute completion.
// No React / Supabase here so it stays trivially testable.

import type {
  AnswerValue,
  QuestionNode,
  SurveyAnswer,
  SurveyOption,
  SurveyQuestion,
} from "./types";

// Build the nested tree from flat question + option rows.
export function buildTree(
  questions: SurveyQuestion[],
  options: SurveyOption[],
): QuestionNode[] {
  const optsByQ = new Map<string, SurveyOption[]>();
  for (const o of options) {
    const arr = optsByQ.get(o.question_id) || [];
    arr.push(o);
    optsByQ.set(o.question_id, arr);
  }
  for (const arr of optsByQ.values())
    arr.sort((a, b) => a.sort_order - b.sort_order);

  const nodes = new Map<string, QuestionNode>();
  for (const q of questions) {
    nodes.set(q.id, { ...q, options: optsByQ.get(q.id) || [], children: [] });
  }

  const roots: QuestionNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_question_id && nodes.has(node.parent_question_id)) {
      nodes.get(node.parent_question_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (list: QuestionNode[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

// The set of option ids selected for a question (works for single/multi/boolean).
export function selectedOptionIds(value: AnswerValue | undefined): Set<string> {
  return new Set(value?.optionIds || []);
}

// Is a question considered "answered"? (type-aware — empty text isn't answered.)
export function isAnswered(
  node: QuestionNode,
  value: AnswerValue | undefined,
): boolean {
  if (!value) return false;
  switch (node.type) {
    case "single":
    case "multi":
    case "boolean":
      return (value.optionIds?.length || 0) > 0;
    case "scale":
      return typeof value.scale === "number";
    case "number":
      return typeof value.number === "number";
    case "text":
      return !!value.text && value.text.trim().length > 0;
  }
}

// Walk the tree and return the flat, ordered list of questions that currently
// apply — a child only applies if its parent_option_id was selected on its
// (applicable, answered) parent.
export function applicableQuestions(
  tree: QuestionNode[],
  answersByQ: Map<string, AnswerValue>,
): QuestionNode[] {
  const out: QuestionNode[] = [];
  const walk = (node: QuestionNode) => {
    out.push(node);
    const chosen = selectedOptionIds(answersByQ.get(node.id));
    for (const child of node.children) {
      // A child with no branch condition always follows its parent; a child
      // gated on an option only shows when that option was picked.
      const gated = child.parent_option_id;
      if (!gated || chosen.has(gated)) walk(child);
    }
  };
  for (const root of tree) walk(root);
  return out;
}

export interface Completion {
  answered: number;
  total: number;
  pct: number; // 0..100 rounded
}

// Completion over the *applicable* questions only.
export function completion(
  applicable: QuestionNode[],
  answersByQ: Map<string, AnswerValue>,
): Completion {
  const total = applicable.length;
  let answered = 0;
  for (const q of applicable) {
    if (isAnswered(q, answersByQ.get(q.id))) answered++;
  }
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  return { answered, total, pct };
}

// Split applicable questions into missing vs answered (for the reveal lists).
export function splitByAnswered(
  applicable: QuestionNode[],
  answersByQ: Map<string, AnswerValue>,
): { missing: QuestionNode[]; answered: QuestionNode[] } {
  const missing: QuestionNode[] = [];
  const answered: QuestionNode[] = [];
  for (const q of applicable) {
    (isAnswered(q, answersByQ.get(q.id)) ? answered : missing).push(q);
  }
  return { missing, answered };
}

// Convenience: turn an answer row list into a Map keyed by question id.
export function answersToMap(answers: SurveyAnswer[]): Map<string, AnswerValue> {
  const m = new Map<string, AnswerValue>();
  for (const a of answers) m.set(a.question_id, a.value);
  return m;
}

// Human-readable rendering of an answer for display in lists / tooltips.
export function formatAnswer(
  node: QuestionNode,
  value: AnswerValue | undefined,
): string {
  if (!value) return "—";
  switch (node.type) {
    case "single":
    case "multi":
    case "boolean": {
      const labels = (value.optionIds || [])
        .map((id) => node.options.find((o) => o.id === id)?.label)
        .filter(Boolean);
      return labels.length ? labels.join(", ") : "—";
    }
    case "scale":
      return typeof value.scale === "number" ? String(value.scale) : "—";
    case "number":
      return typeof value.number === "number" ? String(value.number) : "—";
    case "text":
      return value.text?.trim() || "—";
  }
}
