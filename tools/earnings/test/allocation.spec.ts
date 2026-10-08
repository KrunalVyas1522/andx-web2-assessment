describe('Earnings Allocation Math', () => {
  it('should split budget using exact BigInt math and remainder rule', () => {
    // 3 clips, total views = 10, budget = $10.00 (1000 cents)
    // C1: 4 views (40%) = 400 cents
    // C2: 3 views (30%) = 300 cents
    // C3: 3 views (30%) = 300 cents
    // What if budget is 1000, total views 3, clips each have 1 view?
    // 1000 / 3 = 333 cents per clip. Remainder = 1 cent.
    
    const clips = [
      { id: 'c_3', views: 1n },
      { id: 'c_1', views: 1n },
      { id: 'c_2', views: 1n },
    ];
    const budgetCents = 1000n;
    const totalViews = 3n;
    
    const allocations = clips.map(c => {
      const base = (c.views * budgetCents) / totalViews;
      const remainderScore = (c.views * budgetCents) % totalViews;
      return { ...c, base, remainderScore, final: base };
    });
    
    // Sort by remainder score descending, then string ID ascending
    allocations.sort((a, b) => {
      if (b.remainderScore !== a.remainderScore) return Number(b.remainderScore - a.remainderScore);
      return a.id.localeCompare(b.id);
    });
    
    let remainder = budgetCents % totalViews;
    let i = 0;
    while (remainder > 0n && i < allocations.length) {
      allocations[i].final += 1n;
      remainder -= 1n;
      i++;
    }
    
    // c_1 should win the tie breaker because of ascending string ID
    const c1 = allocations.find(c => c.id === 'c_1')!;
    const c2 = allocations.find(c => c.id === 'c_2')!;
    const c3 = allocations.find(c => c.id === 'c_3')!;
    
    expect(c1.final).toBe(334n);
    expect(c2.final).toBe(333n);
    expect(c3.final).toBe(333n);
  });
});
