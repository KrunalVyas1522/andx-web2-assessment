At 500M events/day (average 5.8k/s, peak 60k/s) across 50M live clips:

**What breaks first:**
The single PostgreSQL database (specifically the `aggregator` schema handling deduplication and `clip_views` inserts) will bottleneck on write IOPS. The `processed_events` table will grow by 500M rows/day (approx 20GB/day with indexes), causing B-Tree index updates to exceed cache memory and heavily thrash the disk during the 60k/s peak bursts.

**What to alert on:**
- Postgres `disk_write_iops` and `buffer_cache_hit_ratio`
- Consumer lag on the `raw_events` BullMQ queue (backpressure activation)
- `earnings` processing latency per campaign (debouncer cycle duration)

**What to change:**
1. **Database Sharding:** Shard the `aggregator` and `earnings` databases by `campaign_id`. Events for different campaigns are mathematically independent, allowing perfect horizontal scaling of the write path.
2. **In-Memory Dedup:** Replace Postgres `processed_events` dedup with a Redis Bloom filter + TTL cache, drastically reducing disk IOPS.
3. **Rollups:** Rather than keeping raw history indefinitely, aggressively roll up `V(clip, t)` into hourly snapshots after the 168-hour active window expires.
