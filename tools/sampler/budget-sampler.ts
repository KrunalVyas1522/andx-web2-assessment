import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:8081';

// We map campaigns with their static budgets for validation
const CAMPAIGNS = [
  { id: 'k_0001', budget_cents: 100000 },
  { id: 'k_0002', budget_cents: 50000 },
];

async function pollCampaign(campaign: typeof CAMPAIGNS[0]) {
  try {
    const response = await axios.get(`${API_URL}/v1/campaigns/${campaign.id}/spend`);
    const spendStr = response.data.total_spend_usd;
    const spendCents = Math.round(parseFloat(spendStr) * 100);

    if (spendCents > campaign.budget_cents) {
      console.error(`❌ FATAL: Campaign ${campaign.id} exceeded budget! Spend: ${spendCents}, Budget: ${campaign.budget_cents}`);
      process.exit(1);
    } else {
      console.log(`✅ Campaign ${campaign.id} safe. Spend: ${spendCents} / Budget: ${campaign.budget_cents}`);
    }
  } catch (error: any) {
    console.error(`Failed to poll ${campaign.id}:`, error.message);
  }
}

async function startSampler() {
  console.log('Starting exact budget sampler. Polling every 200ms...');
  setInterval(() => {
    CAMPAIGNS.forEach(pollCampaign);
  }, 200);
}

startSampler();
