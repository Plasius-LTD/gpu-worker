import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const cdWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/cd.yml"), "utf8");
const ciWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

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

test("keeps same-repository pull-request CI on explicit trusted runners", () => {
  assert.match(ciWorkflow, /pull_request:/u);
  assert.match(ciWorkflow, /runs-on: \[self-hosted, Linux, X64\]/u);
  assert.match(ciWorkflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u);
  assert.doesNotMatch(ciWorkflow, /pull_request_target/u);
  assert.doesNotMatch(ciWorkflow, /fromJSON\(vars\./u);
});
