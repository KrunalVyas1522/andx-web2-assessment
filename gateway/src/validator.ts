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

  if (parsed.v !== 1 && parsed.v !== 2) {
    return { valid: false, event: parsed, rawLine: line };
  }

  if (typeof parsed.event_id !== 'string' || !/^[0-9a-f]{16}$/.test(parsed.event_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }

  if (parsed.v === 1) {
    if (parsed.type !== undefined && parsed.type !== 'view_snapshot') {
      return { valid: false, event: parsed, rawLine: line };
    }
  } else if (parsed.v === 2) {
    if (parsed.type !== 'view_snapshot' && parsed.type !== 'clip_text') {
      return { valid: false, event: parsed, rawLine: line };
    }
  }

  if (typeof parsed.clip_id !== 'string' || !/^c_\d{7}$/.test(parsed.clip_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }
  if (typeof parsed.campaign_id !== 'string' || !/^k_\d{5}$/.test(parsed.campaign_id)) {
    return { valid: false, event: parsed, rawLine: line };
  }

  if (parsed.v === 2 && parsed.type === 'clip_text') {
    if (typeof parsed.caption !== 'string' || parsed.caption.length > 5000) {
      return { valid: false, event: parsed, rawLine: line };
    }
    if (typeof parsed.transcript !== 'string' || parsed.transcript.length > 20000) {
      return { valid: false, event: parsed, rawLine: line };
    }
    return { valid: true, event: parsed, rawLine: line };
  }

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
    const obsDate = new Date(parsed.observed_at);
    if (isNaN(obsDate.getTime()) || obsDate.toISOString() !== parsed.observed_at) return { valid: false, event: parsed, rawLine: line };
    const emDate = new Date(parsed.emitted_at);
    if (isNaN(emDate.getTime()) || emDate.toISOString() !== parsed.emitted_at) return { valid: false, event: parsed, rawLine: line };
    
    const obsTime = obsDate.getTime();
    const emTime = emDate.getTime();
    const minTime = Date.UTC(2020, 0, 1);
    const maxTime = Date.UTC(2100, 0, 1);
    
    if (obsTime < minTime || obsTime >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (emTime < minTime || emTime >= maxTime) return { valid: false, event: parsed, rawLine: line };
    if (emTime < obsTime) return { valid: false, event: parsed, rawLine: line };
    
    if (typeof parsed.views !== 'number' || !Number.isInteger(parsed.views) || parsed.views < 0 || parsed.views > 2000000000) {
      return { valid: false, event: parsed, rawLine: line };
    }

    // Normalize to v2 shape
    parsed = {
      v: 2,
      type: 'view_snapshot',
      event_id: parsed.event_id,
      clip_id: parsed.clip_id,
      campaign_id: parsed.campaign_id,
      creator_id: parsed.creator_id,
      observed_at_ms: obsTime,
      emitted_at_ms: emTime,
      view_count: parsed.views
    };

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

  return { valid: true, event: parsed, rawLine: line };
}
