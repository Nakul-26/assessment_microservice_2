// Maps Arventiq's `code_language` values to this platform's internal judge
// language ids (judge-service-go/pkg/languages/languages.go's Languages map keys).
// Kept as config, not inline in the translator, per docs/arventiq-integration/PLAN.md §6.
export const ARVENTIQ_LANGUAGE_MAP = {
  python: "python",
  python3: "python",
  javascript: "javascript",
  js: "javascript",
  node: "javascript",
  typescript: "typescript",
  ts: "typescript",
  java: "java",
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  csharp: "csharp",
  "c#": "csharp",
  go: "go",
  golang: "go"
};

export function resolveArventiqLanguage(codeLanguage) {
  if (!codeLanguage || typeof codeLanguage !== "string") return null;
  return ARVENTIQ_LANGUAGE_MAP[codeLanguage.trim().toLowerCase()] || null;
}
