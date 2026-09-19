export const DEFAULT_GEMINI_MODEL='gemini-3.6-flash';
export function upgradeGeminiModel(model) {
  return !model || model==='gemini-2.5-flash' ? DEFAULT_GEMINI_MODEL : model;
}
