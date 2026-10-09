import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClipRelevance } from './clip-relevance.entity';
import { ConfigService } from '@nestjs/config';

const BRIEFS: Record<string, any> = {
  'k_00007': {
    brand: 'Nimbus Wallet',
    product: 'Self-custody crypto wallet app for iOS and Android',
    on_brief: "The clip's main subject is Nimbus Wallet: setting it up, using its features (swaps, multi-chain balances, backups, hardware key support, security settings), or reviewing it.",
    rules: [
      "R1: No promises of profit or returns and no price predictions. Quoting a yield or APY, saying a token will rise, or saying viewers cannot lose money all count. A referral code or fee discount does not.",
      "R2: Never show, read out, or ask viewers to share a recovery phrase or private key."
    ]
  },
  'k_00042': {
    brand: 'Drift Arena',
    product: 'Mobile racing game',
    on_brief: "The clip's main subject is Drift Arena: gameplay, tips, car builds and tuning, events, updates, or a review.",
    rules: [
      "R1: No real-money betting, wagering, cash matches, or gambling content.",
      "R2: No cheats, hacks, mod menus, modded APKs, coin generators, or account selling or trading."
    ]
  },
  'k_00133': {
    brand: 'Fuel Bar',
    product: 'High-protein snack bar',
    on_brief: "The clip's main subject is Fuel Bar: taste tests, ingredients and macros, when to eat it, or recipes using it.",
    rules: [
      "R1: No medical claims (cures, treats, fixes, controls a condition) and no guaranteed weight-loss or muscle-gain results. Plain factual statements about macros and ingredients are fine.",
      "R2: Do not disparage a named competitor (calling it bad, fake, a scam, junk, unsafe, poison). Stating a preference or a factual comparison is not disparagement."
    ]
  }
};

const SYSTEM_PROMPT = `You are an AI content moderator evaluating short clips for campaign relevance.
A clip is ON-BRIEF (label 1, true) only if ALL of the following rules are satisfied. If any rule fails, it is OFF-BRIEF (label 0, false).
Apply rules in order:
1. Brief rules: The clip must not break any R1 or R2 rule of its campaign.
2. Right campaign: The clip must not be clearly about a different campaign's product.
3. Brand identifiable: The brand must be named in caption or transcript (hashtags and misspellings like "nimbus walled" count).
4. Main subject: The product must be the main subject. A one-line mention or sponsor shout-out gives 0. A comparison where the brand is one of two main subjects is fine.
5. Sentiment: The overall message about the brand must not be negative (no complaints, "don't download", or mocking). Mixed reviews that recommend the product are fine.

Output ONLY a raw JSON object in this exact format, with no markdown or extra text:
{"on_brief": true, "score": 0.95}

"on_brief" is a boolean. "score" is a float between 0 and 1 indicating confidence.
`;

@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    @InjectRepository(ClipRelevance)
    private readonly relevanceRepo: Repository<ClipRelevance>,
    private configService: ConfigService,
  ) {
    let url = this.configService.get<string>('LLM_BASE_URL') || 'https://openrouter.ai/api/v1';
    // ensure /chat/completions is not already in base url, but we will append it
    if (url.endsWith('/')) url = url.slice(0, -1);
    if (!url.endsWith('/chat/completions')) {
        // Some base URLs might already include /chat/completions if set incorrectly, but standard is just base
        url = url + '/chat/completions';
    }
    this.baseUrl = url;
    this.apiKey = this.configService.get<string>('LLM_API_KEY') || '';
    this.model = this.configService.get<string>('LLM_MODEL') || 'openai/gpt-4o-mini';
  }

  async classifyBatch(events: any[]) {
    // Check which ones we already processed to save money and time
    const clipIds = events.map(e => e.clip_id);
    const existing = await this.relevanceRepo.find({
      where: clipIds.map(id => ({ clip_id: id }))
    });
    const existingIds = new Set(existing.map(e => e.clip_id));
    
    const toProcess = events.filter(e => !existingIds.has(e.clip_id));
    if (toProcess.length === 0) return;

    // Process concurrently with a limit to avoid rate limits
    const concurrencyLimit = 5;
    for (let i = 0; i < toProcess.length; i += concurrencyLimit) {
      const chunk = toProcess.slice(i, i + concurrencyLimit);
      await Promise.all(chunk.map(e => this.classifySingle(e)));
    }
  }

  private async classifySingle(event: any) {
    const brief = BRIEFS[event.campaign_id];
    if (!brief) {
      this.logger.warn(`Unknown campaign ${event.campaign_id} for clip ${event.clip_id}`);
      return;
    }

    const prompt = `Campaign Brief:
Brand: ${brief.brand}
Product: ${brief.product}
On-brief: ${brief.on_brief}
Rules:
${brief.rules.join('\n')}

Clip to evaluate:
Caption: ${event.caption || '(empty)'}
Transcript: ${event.transcript || '(empty)'}
`;

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API returned ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const parsed = JSON.parse(content);

      await this.relevanceRepo.save({
        clip_id: event.clip_id,
        campaign_id: event.campaign_id,
        on_brief: Boolean(parsed.on_brief),
        score: Number(parsed.score) || 0.0,
        model: this.model
      });
      this.logger.log(`Classified ${event.clip_id}: ${parsed.on_brief}`);

    } catch (err: any) {
      this.logger.error(`Failed to classify ${event.clip_id}: ${err.message}`);
    }
  }
}
