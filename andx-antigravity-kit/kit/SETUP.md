# Setup: Antigravity multi-agent kit for the ANDX Web2 take-home

## 0. Prerequisites on your machine
Docker Desktop (6 CPUs, 10 GB memory for the full run), Node 20+, Python 3, `make`, git (user.name/user.email already configured),
about 20 GB free disk. The full preset takes 20-45 minutes per run.

## 1. Create the repo
```bash
./bootstrap.sh /path/to/ANDX-Web2-Assessment.zip ~/work/andx-web2
```
This gives you two clean commits (untouched kit, then the agent setup). `docs/ASSESSMENT.md` is gitignored on purpose.

## 2. Open it in Antigravity
- Open `~/work/andx-web2` as the workspace. Rules in `AGENTS.md` and `.agents/rules/` are always on. Skills in `.agents/skills/`
  are picked by the model from their descriptions (that is the auto-invocation). Workflows run with `/deliver`, `/status`, `/release`.
- Custom agents live in `.agents/agents/<name>/agent.md`. If your build does not list them in `/agents` or the Agent Manager,
  the orchestrator falls back to passing each `agent.md` as the subagent's instructions (already in its prompt).
- Select the model **Gemini 3.1 Pro (High)** for the orchestrator conversation.
- Agent settings: allow terminal commands to run without per-command approval, but keep a deny list for `git push`, `git push --force`, `git reset --hard`,
  `rm -rf /`, `docker system prune`. The exact setting names differ by version; check Agent settings.

## 3. Start
Paste `MASTER_PROMPT.md` into a new orchestrator conversation. It runs `/status` then `/deliver` and stops at three checkpoints.

## 4. Your jobs (the agents cannot do these for you)
1. Review `docs/CONTRACTS.md` at checkpoint 1. You will be asked about every design choice on the follow-up call.
2. Fill `docs/TIME_LOG.md` with your real hours. Annotate `docs/ai-log.md` with what you changed or rejected.
3. Read `docs/EXPLAIN-ME.md` and re-derive at least the allocation, dedup and outbox code yourself.
4. Set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` in your shell for the classifier. Never commit them.
5. After `/release`: `git remote add origin <your-private-repo>`, `git push -u origin main --tags`, add the reviewer as a collaborator, then send the link.
