import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

const cdWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/cd.yml"), "utf8");
const ciWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const packageMetadata = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
const trustedRepository = new URL(packageMetadata.repository.url.replace(/^git\+/u, ""))
  .pathname.slice(1).replace(/\.git$/u, "");

test("uses exact-main hosted OIDC publication without write tokens", () => {
  assert.match(cdWorkflow, /runs-on: ubuntu-latest/u);
  assert.match(cdWorkflow, /environment: production/u);
  assert.match(cdWorkflow, /id-token: write/u);
  assert.match(cdWorkflow, /Enforce exact-main successful CI/u);
  assert.match(cdWorkflow, /refs\/remotes\/origin\/main/u);
  assert.match(cdWorkflow, /-f branch=main/u);
  assert.match(cdWorkflow, /-f event=push/u);
  assert.match(cdWorkflow, /-f head_sha="\$\{EXPECTED_SHA\}"/u);
  assert.match(cdWorkflow, /conclusion == "success"/u);
  assert.match(cdWorkflow, /Verify release runtime/u);
  assert.match(cdWorkflow, /ACTUAL_NODE%%\.\*/u);
  assert.match(cdWorkflow, /"11\.5\.1"/u);
  assert.match(cdWorkflow, /--provenance/u);
  assert.doesNotMatch(cdWorkflow, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
});

test("runs CI only on approved self-hosted capacity for trusted branch events", () => {
  assert.match(ciWorkflow, /workflow_dispatch:/u);
  assert.match(ciWorkflow, /push:\s*\n\s+branches: \["\*\*"\]/u);
  assert.equal(ciWorkflow.match(/group: Public CI - Quarantined/gu)?.length, 2);
  assert.equal(ciWorkflow.match(/labels: \[self-hosted, Linux, X64\]/gu)?.length, 2);
  assert.equal(ciWorkflow.match(/persist-credentials: false/gu)?.length, 2);
  assert.equal(ciWorkflow.match(/timeout-minutes: (?:10|15)/gu)?.length, 2);
  assert.doesNotMatch(ciWorkflow, /\n\s+cache:\s*["']?npm["']?/u);
  assert.equal(ciWorkflow.match(/package-manager-cache: false/gu)?.length, 2);
  assert.doesNotMatch(ciWorkflow, /pull_request|ubuntu-|windows-|macos-|fromJSON\(|inputs\./u);
});

const guards = [...ciWorkflow.matchAll(/^ {4}if: \$\{\{ (.+) \}\}$/gmu)].map((match) => match[1]);
const scenarios = [
  ["main push", "push", trustedRepository, "branch", true],
  ["manual branch validation", "workflow_dispatch", trustedRepository, "branch", true],
  ["same-repository pull request", "pull_request", trustedRepository, "branch", false],
  ["fork pull request", "pull_request", "fork/gpu-worker", "branch", false],
  ["privileged pull request", "pull_request_target", trustedRepository, "branch", false],
  ["fork push", "push", "fork/gpu-worker", "branch", false],
  ["tag push", "push", trustedRepository, "tag", false],
  ["manual tag validation", "workflow_dispatch", trustedRepository, "tag", false],
];

for (const [name, event_name, repository, ref_type, allowed] of scenarios) {
  test(`CI admission: ${name}`, () => {
    assert.equal(guards.length, 2, "every CI job needs an admission guard");
    for (const guard of guards) {
      const github = {
        event_name,
        repository,
        ref_type,
        event: { pull_request: { head: { repo: { full_name: repository } } } },
      };
      assert.equal(runInNewContext(guard, { github }, { timeout: 100 }), allowed);
    }
  });
}

test("documents the scheduling boundary and keeps publication admission independent", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
  assert.match(readme, /Public CI - Quarantined/u);
  assert.match(readme, /trusted-publisher binding is verified/u);
  assert.match(ciWorkflow, /Enforce line coverage >= 80%/u);
  assert.match(ciWorkflow, /Verify public artifact integrity/u);
  assert.doesNotMatch(ciWorkflow, /id-token: write|environment: production/u);
});
