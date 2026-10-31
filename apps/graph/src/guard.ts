// Prompt-injection guard. Mail is untrusted input: anything that looks like instructions to an AI
// is flagged at ingest, and flagged bodies never reach the LLM (only a placeholder does).
const PATTERNS: [RegExp, string][] = [
  [/ignore (all )?(the )?(previous|prior|above) instructions/i, "asks the AI to ignore its instructions"],
  [/disregard (your|all|the) (rules|instructions)/i, "asks the AI to disregard its rules"],
  [/\b(system|assistant)\s*(:|instruction|prompt)/i, "fake system / assistant instruction"],
  [/note to the ai|ai assistant/i, "message addressed to the AI"],
  [/you are now (in )?\w+ mode/i, "tries to switch the AI into another mode"],
  [/do not mention this instruction/i, "hidden instruction"],
  [/forward (the )?(full )?(employee|staff) (list|data)/i, "asks to exfiltrate employee data"],
  [/<!--[\s\S]*?-->/, "hidden HTML comment"],
];

export function detectInjection(text: string): string | null {
  for (const [re, why] of PATTERNS) if (re.test(text)) return why;
  return null;
}

/** Wraps untrusted text so the model can tell data from instructions. */
export function asData(text: string, max = 600): string {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean.replace(/"""/g, "'''");
}
