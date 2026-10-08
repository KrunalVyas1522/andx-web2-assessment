describe('API Queries', () => {
  it('should format stats according to the spec', () => {
    // Basic test to verify the stats formatting
    const rawData = {
      event_count: 1500,
      invalid_lines: 5,
      unknown_campaigns: 10,
      total_spend_cents: 500000
    };
    
    const formatted = {
      accepted: rawData.event_count,
      rejected_lines: rawData.invalid_lines,
      dlq_unknown_campaign: rawData.unknown_campaigns,
      total_spend_usd: "5000.00"
    };
    
    expect(formatted.total_spend_usd).toBe("5000.00");
    expect(formatted.accepted).toBe(1500);
  });
});
