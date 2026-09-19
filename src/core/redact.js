const patterns = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
  [/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, '[PHONE/ID]'],
  [/\b(?:\d{1,2}[/-]){2}\d{2,4}\b/g, '[DATE]'],
  [/\b(?:AIza[\w-]{20,}|sk-[\w-]{12,})\b/g, '[KEY]'],
  [/\b(name|full name|first name|last name|address|street|date of birth|dob|passport|ssn|aadhaar|pan|password|passcode|otp|verification code|api key)\s*[:=]\s*[^\n|;]+/gi, '$1: [REDACTED]'],
];
export function redact(text = '', {profile = {}, keywords = []} = {}) {
  let out = String(text);
  const values = [...Object.values(profile), ...keywords].filter(v => typeof v === 'string' && v.trim()).sort((a,b)=>b.length-a.length);
  for (const value of values) {
    const pattern=value.trim().split(/\s+/).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
    out=out.replace(new RegExp(pattern,'gi'),'[PRIVATE]');
  }
  for (const [pattern,replacement] of patterns) out = out.replace(pattern,replacement);
  return out;
}
export function sanitizeSnapshot(raw, rules) {
  return {
    revision: raw.revision,
    origin: redact(new URL(raw.url).origin,rules),
    text: redact(raw.text, rules).slice(0,18000),
    elements: (raw.elements || []).map(e=>({id:e.id,tag:e.tag,type:e.type || '',label:redact(e.label,rules).slice(0,160)})),
    unsupported: raw.unsupported || 0,
  };
}
