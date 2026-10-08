---
description: Final gate and submission pack: verify every deliverable and checklist item with evidence, prepare tags and the zip, draft the cover note. The human pushes.
---

# /release
1. Clean-clone test: clone the repo into a temp dir, `docker compose up -d --build`, both health checks pass within 10 minutes. Save evidence.
2. `make test` passes using only Docker and make. Confirm it covers: validation + classification order; V(clip,t) and views_gained incl. an out-of-order downward revision; allocation incl. remainder rule.
3. Small flow on seed 7: `... checks passed, 0 failures` (both phases). Save the raw output.
4. Confirm evidence exists for: full-preset run, kill tests per service, earnings stop/start, broker restart, replay storm, hostile input. Anything missing goes in the README's unfinished list.
5. Delegate to `docs-release`: README, DESIGN.md (<= 300 words), EVAL.md (from ml-engineer's evidence), AI_USAGE.md, docs/EXPLAIN-ME.md, docs/SUBMISSION.md.
6. Repo hygiene: `git status` clean; no data, secrets, `docs/ASSESSMENT.md` or node_modules tracked (`git ls-files`); `web2-kit/generator` identical to the original (`git diff --stat` against the first commit).
7. Review `git log --oneline`: messages follow the git skill; no giant "final" commit. Do NOT rewrite history that the human has already pushed.
8. Tag `v1.0-submission`; create the fallback zip with `git archive`.
9. Output a final report: checklist with evidence links, honest list of gaps, and the exact commands for the human:
   `git remote add origin <private-repo-url>` / `git push -u origin main --tags`, then add the reviewer as a collaborator.
**STOP. The human reads EXPLAIN-ME.md, fills TIME_LOG.md and the AI log review cells, edits AI_USAGE.md so it is true, and pushes.**
