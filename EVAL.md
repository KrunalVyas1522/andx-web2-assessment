# AI Classifier Evaluation

**Approach:**
We utilized OpenRouter's OpenAI-compatible API to interact with a highly capable free-tier LLM model. The strategy relies on crafting a rigid system prompt with the exact labeling rules from `labeling-rules.md`. The clip transcript and caption are injected securely into delimited blocks to prevent prompt injection.

**Why:**
This approach requires zero infrastructure overhead, stays comfortably within the $0.50 per 1k clips budget (effectively $0.00), and avoids the latency of pulling heavy embedding models into the container memory, staying within the 1.5GB cap.

**Evaluation Setup & Metrics:**
*Metrics pending final evaluation.*
