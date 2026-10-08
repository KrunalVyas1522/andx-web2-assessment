import { validateLine } from '../src/validator';

describe('Gateway Validator', () => {
  it('should validate a correct v2 view_snapshot event', () => {
    const valid = validateLine('{"v":2,"type":"view_snapshot","event_id":"0d9a51f2c37be801","clip_id":"c_0004712","campaign_id":"k_00015","creator_id":"u_002513","observed_at_ms":1767572203558,"emitted_at_ms":1767572283203,"view_count":3150}');
    expect(valid).toBeTruthy();
  });

  it('should fail on invalid JSON', () => {
    const valid = validateLine('not-json');
    expect(valid).toBeFalsy();
  });

  it('should fail if event_id is missing', () => {
    const valid = validateLine('{"v":2,"type":"view_snapshot","clip_id":"c_0004712","campaign_id":"k_00015","creator_id":"u_002513","observed_at_ms":1767572203558,"emitted_at_ms":1767572283203,"view_count":3150}');
    expect(valid).toBeFalsy();
  });
});
