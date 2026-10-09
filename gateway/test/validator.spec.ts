import { validateEvent } from '../src/validator';

describe('Gateway Validator', () => {
  it('should validate a correct v2 view_snapshot event', () => {
    const res = validateEvent('{"v":2,"type":"view_snapshot","event_id":"0d9a51f2c37be801","clip_id":"c_0004712","campaign_id":"k_00015","creator_id":"u_002513","observed_at_ms":1767572203558,"emitted_at_ms":1767572283203,"view_count":3150}');
    expect(res.valid).toBeTruthy();
  });

  it('should fail on invalid JSON', () => {
    const res = validateEvent('not-json');
    expect(res.valid).toBeFalsy();
  });

  it('should fail if event_id is missing', () => {
    const res = validateEvent('{"v":2,"type":"view_snapshot","clip_id":"c_0004712","campaign_id":"k_00015","creator_id":"u_002513","observed_at_ms":1767572203558,"emitted_at_ms":1767572283203,"view_count":3150}');
    expect(res.valid).toBeFalsy();
  });
});
