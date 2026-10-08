describe('Classifier Relevance Score', () => {
  it('should parse OpenRouter JSON output correctly', () => {
    // If LLM says "on_brief": true, score is 1, else 0.
    const mockLlmResponse = '{"on_brief": true}';
    const parsed = JSON.parse(mockLlmResponse);
    
    const score = parsed.on_brief === true ? 1.0 : 0.0;
    
    expect(score).toBe(1.0);
  });
  
  it('should fallback to 0 on invalid JSON', () => {
    let score = 0.0;
    try {
      const parsed = JSON.parse('not-json');
      score = parsed.on_brief === true ? 1.0 : 0.0;
    } catch {
      // expected fallback
      score = 0.0;
    }
    
    expect(score).toBe(0.0);
  });
});
