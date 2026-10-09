CREATE SCHEMA IF NOT EXISTS api;
CREATE TABLE IF NOT EXISTS api.campaigns (
    id VARCHAR(50) PRIMARY KEY,
    budget_cents BIGINT NOT NULL,
    cpm_cents BIGINT NOT NULL,
    per_clip_cap_cents BIGINT NOT NULL,
    end_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE SCHEMA IF NOT EXISTS aggregator;
CREATE TABLE IF NOT EXISTS aggregator.processed_events (
    event_id VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS aggregator.late_events (
    event_id VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS aggregator.clip_view_snapshots (
    clip_id VARCHAR(50) NOT NULL,
    campaign_id VARCHAR(50) NOT NULL,
    creator_id VARCHAR(50) NOT NULL,
    views BIGINT NOT NULL,
    observed_at_ms BIGINT NOT NULL,
    PRIMARY KEY (clip_id, observed_at_ms)
);
CREATE TABLE IF NOT EXISTS aggregator.outbox (
    id UUID PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS aggregator.dlq (
    event_id VARCHAR(64) PRIMARY KEY,
    reason VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL
);

CREATE SCHEMA IF NOT EXISTS earnings;
CREATE TABLE IF NOT EXISTS earnings.processed_updates (
    aggregator_tx_id UUID PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS earnings.dirty_campaigns (
    campaign_id VARCHAR(50) PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS earnings.campaign_spend (
    campaign_id VARCHAR(50) PRIMARY KEY,
    spend_cents BIGINT NOT NULL DEFAULT 0,
    raw_earnings_cents BIGINT NOT NULL DEFAULT 0,
    paid_clips BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS earnings.creator_earnings (
    creator_id VARCHAR(50) NOT NULL,
    campaign_id VARCHAR(50) NOT NULL,
    clips BIGINT NOT NULL DEFAULT 0,
    earned_cents BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (creator_id, campaign_id)
);

CREATE SCHEMA IF NOT EXISTS classifier;
CREATE TABLE IF NOT EXISTS classifier.clip_relevance (
    clip_id VARCHAR(50) PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    on_brief BOOLEAN NOT NULL,
    score NUMERIC NOT NULL,
    model VARCHAR(100) NOT NULL
);
