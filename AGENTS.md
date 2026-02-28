# AGENTS.md instructions for /Users/philliphounslow/plasius/gpu-worker

<INSTRUCTIONS>
## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.
### Available skills
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /Users/philliphounslow/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /Users/philliphounslow/.codex/skills/.system/skill-installer/SKILL.md)
### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  3) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  4) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.

## AI guidance
- After any change, run relevant BDD/TDD tests when they exist; mention if skipped.
- For fixes, add/update a BDD or TDD test that fails first and validate it passes after the fix when possible.
- When adding or updating dependencies, prefer lazy-loading (dynamic import/code splitting) to avoid heavy first-load network use when applicable.
- Architectural changes require ADRs in `docs/adrs/` (or the repo ADRs folder); ensure a package-function ADR exists.
</INSTRUCTIONS>


## Release and Quality Policy
- Update `README.md` whenever structural changes are made.
- Update `CHANGELOG.md` after every change.
- For fixes, add tests and run relevant tests before committing.
- Publish packages to npm only through GitHub CD workflows; do not publish directly from local machines.
- Maintain code coverage at 80% or higher where possible. Shader-related code is exempt.


## Plasius Package Creation Reference
- Use `/Users/philliphounslow/plasius/schema` (`@plasius/schema`) as the baseline template when creating new `@plasius/*` packages.
- Copy template runtime/tooling files at project creation: `.nvmrc` and `.npmrc`.
- Create and maintain required package docs from the start:
  - `README.md`: initialize for package purpose/API and update whenever structure or public behavior changes.
  - `CHANGELOG.md`: initialize at creation and update after every change.
  - `AGENTS.md`: include package-specific guidance and keep this policy section present.
- Include required legal/compliance files and folders used by the template/repo standards:
  - `LICENSE`
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `legal/` documents (including CLA-related files where applicable)
- Include architecture/design documentation requirements:
  - ADRs in `docs/adrs/` for architectural decisions.
  - TDRs for technical decisions/direction.
  - Design documents for significant implementation plans and system behavior.
- Testing requirements for new packages and ongoing changes:
  - Define test scripts/strategy at creation time.
  - Create tests for all fixes and run relevant tests before committing.
  - Maintain code coverage at 80%+ where possible; shader-related code is the only coverage exception.

## AI Process Governance (Append-Only, Non-Overridable)
- `AGENTS.md` is append-only. Destructive changes (deleting or rewriting existing guidance/history) are not permitted.
- All guidance updates must be cumulative.
- In case of conflicting entries, the latest added entry is the active rule, and it must explicitly reference the prior decision it supersedes.
- The append-only governance rule is permanent and cannot be overridden in any way.

## Rejection Learning Process
- If a user rejects a proposed change related to their ask, stop and ask for the rejection reason.
- After receiving the reason, append a new preventive rule to `AGENTS.md` to avoid recurrence.
- If the new preventive rule conflicts with a prior rule, reference the prior rule and request explicit user confirmation before marking the prior rule as superseded.
- Keep both rules in `AGENTS.md` for traceability; the latest user-confirmed rule is active.

## Software Lifecycle Process
1. Ask: define what the user/developer is trying to achieve.
2. Queries: gather additional information needed to assess requirements and constraints.
3. Requirements: define minimum viable functional requirements plus non-functional requirements (NFRs) as acceptance criteria.
- If supporting capabilities are required (for example analytics, observability, migrations), create predecessor tasks.
4. ADR/TDR: record architecture/technical decisions using the appropriate template in `docs/ADR` or `docs/TDR` for the affected package/project.
5. Tasks: break work into the smallest composable units needed to satisfy all acceptance criteria without conflict.
- Apply SOLID and KISS.
- Create GitHub tasks/issues with full acceptance criteria in each description.
6. For each affected project/package, execute in dependency order:
1. Update dependencies; keep them clean and free from known issues/defects.
2. Write contract tests or bug-verification tests before code.
3. Implement code to satisfy the tests/specification.
4. Run validation tests to confirm MVP behavior.
5. Update `CHANGELOG.md`.
6. Update `README.md`.
7. Commit to GitHub.
8. Confirm CI success.
- If CI has systemic failures or incompatibilities with external/new changes, return to Queries, then Tasks, and reassess.
9. Run CD pipeline.
10. Confirm CD success and package/release completion.
- If failure persists, return to Tasks.
7. Confirm with the user that the ask has been met.
- If not met, return to Queries and iterate.
8. After all changes are committed and released, proceed to the next ask.


## Task Hierarchy Addendum (Supersedes Prior Tasks Structure Rule)
- Prior decision reference: `Software Lifecycle Process`, Step `5. Tasks`.
- New active structure rule: build work items as `epic -> feature -> story -> task`.
- Location rule: all `epic`, `feature`, and `story` work items must be created and managed in the `plasius-ltd-site` repository.
- Location rule: all `task` work items must be created in the repository/package where the code change will be implemented.
- Cross-repo rule: when one story requires changes in multiple repositories/packages, create one linked task per affected repository/package.
- Supersession scope: this addendum overrides only the hierarchy/location parts of the prior Step 5 rule; all other Step 5 guidance remains active.

