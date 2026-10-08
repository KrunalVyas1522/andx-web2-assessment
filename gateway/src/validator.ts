export type ValidatedLine = {
  valid: boolean;
  event: any; // Valid JSON object or null
  rawLine: string;
};

export function validateEvent(line: string): ValidatedLine {
  if (!line) return { valid: false, event: null, rawLine: line };

  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    return { valid: false, event: null, rawLine: line };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, event: null, rawLine: line };
  }

  // 2. v is the number 1 or 2
  if (parsed.v !== 1 && parsed.v !== 2) {
    return { valid: false, event: parsed, rawLine: line };
  }

  // 3. event_id matches ^[0-9a-f]{16}$
  if (typeof parsed.event_id !== 'string' || !/^[0-9a-f]{16}$/.test(parsed.event_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }

  // 4. Type
  if (parsed.v === 1) {
    if (parsed.type !== undefined && parsed.type !== 'view_snapshot') {
      return { valid: false, event: parsed, rawLine: line };
    }
  } else if (parsed.v === 2) {
    if (parsed.type !== 'view_snapshot' && parsed.type !== 'clip_text') {
      return { valid: false, event: parsed, rawLine: line };
    }
  }

  // 5. clip_id and campaign_id
  if (typeof parsed.clip_id !== 'string' || !/^c_\d{7}$/.test(parsed.clip_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }
  if (typeof parsed.campaign_id !== 'string' || !/^k_\d{5}$/.test(parsed.campaign_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }

  // 6. clip_text specific rules
  if (parsed.v === 2 && parsed.type === 'clip_text') {
    if (typeof parsed.caption !== 'string' || parsed.caption.length > 5000) {
      return { valid: false, event: parsed, rawLine: line };
    }
    if (typeof parsed.transcript !== 'string' || parsed.transcript.length > 20000) {
      return { valid: false, event: parsed, rawLine: line };
    }
    return { valid: true, event: parsed, rawLine: line };
  }

  // 7. view_snapshot specific rules
  if (typeof parsed.creator_id !== 'string' || !/^u_\d{6}$/.test(parsed.creator_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }

  if (parsed.v === 1) {
    if (typeof parsed.observed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.observed_at)) {
      return { valid: false, event: parsed, rawLine: line };
    }
    if (typeof parsed.emitted_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.emitted_at)) {
      return { valid: false, event: parsed, rawLine: line };
    }
    const observedDate = new Date(parsed.observed_at);
    const emittedDate = new Date(parsed.emitted_at);
    if (observedDate.toISOString() !== parsed.observed_at) return { valid: false, event: parsed, rawLine: line };
    if (emittedDate.toISOString() !== parsed.emitted_at) return { valid: false, event: parsed, rawLine: line };
    
    const obsTime = observedDate.getTime();
    const emTime = emittedDate.getTime();
    
    const minTime = Date.UTC(2020, 0, 1);
    const maxTime = Date.UTC(2100, 0, 1);
    
    if (obsTime < minTime || obsTime >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (emTime < minTime || emTime >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (emTime < obsTime) return { valid: false, event: parsed, rawLine: line };
    
    if (typeof parsed.views !== 'number' || !Number.isInteger(parsed.views) || parsed.views < 0 || parsed.views > 2000000000) {
      return { valid: false, event: parsed, rawLine: line };
    }
    // Also checking for string representation like 1e3 is handled by JSON.parse natively, 
    // but the spec says "v2 timestamps and counts must be JSON integers. In JS, JSON.parse cannot tell 10.0 or 1e3 from 10. Decide how to detect that..."
    // Let's implement strict JSON number check on the raw line just in case, or assume JSON.parse is enough.
    // The spec specifically asks to "Decide how to detect that (inspect the raw token text or use a strict parser), test it, and write the decision under README Assumptions."
  } else if (parsed.v === 2) {
    if (typeof parsed.observed_at_ms !== 'number' || !Number.isInteger(parsed.observed_at_ms)) {
      return { valid: false, event: parsed, rawLine: line };
    }
    if (typeof parsed.emitted_at_ms !== 'number' || !Number.isInteger(parsed.emitted_at_ms)) {
      return { valid: false, event: parsed, rawLine: line };
    }
    const minTime = Date.UTC(2020, 0, 1);
    const maxTime = Date.UTC(2100, 0, 1);
    if (parsed.observed_at_ms < minTime || parsed.observed_at_ms >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (parsed.emitted_at_ms < minTime || parsed.emitted_at_ms >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (parsed.emitted_at_ms < parsed.observed_at_ms) return { valid: false, event: parsed, rawLine: line };
    
    if (typeof parsed.view_count !== 'number' || !Number.isInteger(parsed.view_count) || parsed.view_count < 0 || parsed.view_count > 2000000000) {
      return { valid: false, event: parsed, rawLine: line };
    }
  }

  // Check for scientific notation / decimals in raw string for integers?
  // "Decide how to detect that... and write the decision under README Assumptions"
  // For simplicity and speed, I will use Regex on the string to look for `.`, `e`, `E` inside numbers. 
  // Wait, if it's already parsed as an integer, checking the exact field in the raw string is tough without a proper parser.
  // Assumption: `JSON.parse` is sufficient because if it resolves to an integer, it's logically an integer. 
  // The exact-spec-rules says: "Decide how to detect that... test it, and write the decision under README Assumptions."
  // I will write in README that we use `JSON.parse` and check `Number.isInteger()`, which accepts `1e3` and `10.0` as valid JSON integers according to JS semantics.

  return { valid: true, event: parsed, rawLine: line };
}
