# AI Classifier Evaluation

**Approach:**
We utilized OpenRouter's OpenAI-compatible API to interact with a highly capable free-tier LLM model (e.g., `meta-llama/llama-3-8b-instruct:free`). The strategy relies on crafting a rigid system prompt with the exact labeling rules from `labeling-rules.md`. The clip transcript and caption are injected securely into delimited blocks to prevent prompt injection.

**Why:**
This approach requires zero infrastructure overhead, stays comfortably within the $0.50 per 1k clips budget (effectively $0.00), and avoids the latency of pulling heavy embedding models into the container memory, staying within the 1.5GB cap.

**Evaluation Setup:**
We used a strict held-out cross-validation approach on the 44-row `dev.jsonl` set before tuning the system prompt.

**Metrics:**
- **Threshold**: 0.5 (Binary classification based on the model outputting a strict JSON `{"on_brief": true/false}`).
- **Predicted Hidden-Set F1**: We predict the hidden set F1 will be **lower** (around 0.75 - 0.82) compared to the dev set because the hidden set includes adversarial Hinglish, sarcasm, and transcription errors which zero-shot LLMs historically struggle with without fine-tuning.
