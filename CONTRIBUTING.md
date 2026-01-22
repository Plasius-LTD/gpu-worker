# Contributing to @plasius/gpu-worker

First off: thanks for taking the time to contribute!
This document explains how to work on the project, how to propose changes, and what we expect in pull requests.

> TL;DR
>
> - Be respectful and follow the Code of Conduct.
> - Open an issue before large changes; small fixes can go straight to a PR.
> - Write tests, keep coverage steady or improving.
> - Use Conventional Commits.
> - Don’t include real PII in code, issues, tests, or logs.

---

## Code of Conduct

Participation in this project is governed by our **Code of Conduct** (see `CODE_OF_CONDUCT.md`). By participating, you agree to abide by it.

## Licensing & CLA

This project is open source (see `LICENSE`). To protect contributors and users, we require contributors to agree to our **Contributor License Agreement (CLA)** before we can merge PRs (see `legal/CLA.md`). You’ll be prompted automatically by the CLA bot on your first PR.

> If your company has special legal needs, please contact the maintainers before sending large PRs.

## Security

**Never** report security issues in public issues or PRs. Instead, follow the process in `SECURITY.md`.

---

## What this project does

`@plasius/gpu-worker` provides a minimal GPU worker runtime for WebGPU:

- A lock-free job queue (via `@plasius/gpu-lock-free-queue`) for WGSL workloads.
- WGSL worker entry points that dequeue jobs and run a ray tracing kernel.
- Demo that renders a ray traced scene from queued tile jobs.

---

## Getting started (local dev)

### Prerequisites

- A modern browser with WebGPU enabled.
- Optional: Node.js or Python if you want a local static server.

### Install

No install required for the demo.

### Build

No build step yet (plain JS + WGSL).

### Test

No automated tests yet. Please validate changes by running the demo.

### Lint & format

No lint/format tooling is wired up yet.

---

## How to propose a change

### 1) For bugs

- Search existing issues first.
- Open a new issue with:
  - Clear title, steps to reproduce, expected vs actual behaviour,
  - Minimal repro (code snippet or small repo),
  - Environment info (OS, Node, package version).

### 2) For features / refactors

- For anything non-trivial, open an issue first and outline the proposal.
- If the change affects public API or architecture, add an ADR draft (see `docs/adrs/`).
  - If there is no ADR folder yet, include the architectural note in the PR description.

### 3) Good first issues

We label approachable tasks as **good first issue** and **help wanted**.

---

## Branch, commit, PR

**Branching**

- Fork or create a feature branch from `main`: `feat/xyz` or `fix/abc`.

**Commit messages** (Conventional Commits)

- `feat: add physics job entry point`
- `fix: correct queue tile dispatch`
- `docs: clarify job payload guidance`
- `refactor: tighten worker shader layout`
- `test: add demo sanity checks`
- `chore: bump demo defaults`

**Pull Requests**

- Keep PRs focused and small when possible.
- Include tests for new/changed behaviour.
- Update docs (README, JSDoc, ADRs) as needed.
- Add a clear description of what & why, with before/after examples if useful.
- Ensure the demo runs cleanly (no WebGPU validation errors).

**PR checklist**

- [ ] Title uses Conventional Commits
- [ ] Tests added/updated
- [ ] Lint passes (`npm run lint`)
- [ ] Docs updated (README/CHANGELOG if needed)
- [ ] Demo runs (no validation errors)

---

## Coding standards

- **Language:** JavaScript + WGSL.
- **Style:** Keep WGSL and JS simple and explicit; favor clarity over cleverness.
- **Tests:** Demo-driven validation for now.
- **Public API:** Aim for backward compatibility; use SemVer and mark breaking changes clearly (`feat!:` or `fix!:`).
- **Performance:** Avoid excessive allocations in hot paths; keep atomic contention low where possible.
- **Docs:** Update README for any public API or demo changes.

### WGSL specifics

- Keep buffer layouts explicit and aligned.
- Document any changes to queue invariants or sequence arithmetic.
- Avoid undefined behavior; prefer explicit bounds checks.

---

## Adding dependencies

- Minimise runtime dependencies; prefer dev dependencies.
- Justify any new runtime dependency in the PR description (size, security, maintenance).
- Avoid transitive heavy deps unless critical.

---

## Versioning & releases

- We follow **SemVer**.
- Breaking changes require a major bump and migration notes.
- Keep the `CHANGELOG.md` (or release notes) clear about user-facing changes.

---

## Documentation

- Update `README.md` with new features or setup steps.
- Add or update ADRs in `docs/adrs/` for architectural decisions.
- Keep examples minimal, copy-pasteable, and tested when feasible.

---

## Maintainers’ process (overview)

- Triage new issues weekly; label and assign.
- Review PRs for correctness, tests, and docs.
- Squash-merge with Conventional Commit titles.
- Publish from CI when applicable.

---

## Questions

If you have questions or want feedback before building:

- Open a discussion or issue with a short proposal,
- Or draft a PR early (mark as **Draft**) to get directional feedback.

Thanks again for contributing 💛
