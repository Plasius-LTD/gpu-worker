const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("automatically hands prepared main to CI-qualified OIDC publication", () => {
  const cd = read(".github/workflows/cd.yml");
  const prepare = read(".github/workflows/release-prepare.yml");
  const publish = cd.slice(cd.indexOf("\n  publish:"));
  assert.match(cd, /Wait for successful exact-SHA main CI/u);
  assert.match(cd, /actions\/workflows\/cd.yml\/dispatches/u);
  assert.match(cd, /"phase": "publish"/u);
  assert.match(cd, /-f event=push/u);
  assert.match(cd, /-f head_sha="\$\{EXPECTED_SHA\}"/u);
  assert.match(publish, /environment: production/u);
  assert.match(publish, /id-token: write/u);
  assert.match(publish, /--inventory-stdin/u);
  assert.match(publish, /npm publish "\.\/\$\{TARBALL\}" --ignore-scripts/u);
  assert.doesNotMatch(publish, /npm ci|npm run |NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.match(prepare, /node scripts\/release-changelog.mjs prepare/u);
  assert.doesNotMatch(prepare, /\(placeholder\)|--force-with-lease/u);
});

test("uses schema's fixed runner selection and automatic trusted-head admission", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /name: Trusted head admission/u);
  assert.equal(ci.match(/needs: trusted_head/gu)?.length, 2);
  assert.equal(ci.match(/runs-on: \$\{\{ fromJSON\(github.event_name == 'pull_request'/gu)?.length, 2);
  assert.match(ci, /\["ubuntu-latest"\]/u);
  assert.match(ci, /\["self-hosted","Linux","X64"\]/u);
  assert.doesNotMatch(ci, /pull_request_target|fromJSON\(vars\./u);
  assert.ok(ci.indexOf("npm run privacy:check") < ci.indexOf("npm ci"));
});

test("sealed artifact accepts only the reviewed package inventory", () => {
  const { EXPECTED_PACKED_PATHS } = require("../scripts/verify-public-package.cjs");
  const verifier = path.join(root, "scripts/verify-public-package.cjs");
  const run = (paths) => spawnSync(process.execPath, [verifier, "--inventory-stdin"], {
    cwd: root, encoding: "utf8", input: paths.map((p) => `package/${p}`).join("\n") + "\n",
  });
  const accepted = run(EXPECTED_PACKED_PATHS);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(run(EXPECTED_PACKED_PATHS.slice(1)).status, 1);
  const rejected = run([...EXPECTED_PACKED_PATHS, "unexpected-SYNTHETIC-file.txt"]);
  assert.equal(rejected.status, 1);
  assert.doesNotMatch(rejected.stderr, /SYNTHETIC/u);
  assert.equal(run([...EXPECTED_PACKED_PATHS, EXPECTED_PACKED_PATHS[0]]).status, 1);
});

test("release metadata promotion preserves published history and is idempotent", async () => {
  const { promoteChangelog, assertChangelog } = await import("../scripts/release-changelog.mjs");
  const history = "## [1.0.0] - 2026-01-01\n\n- Existing API.\n";
  const input = "## [Unreleased]\n\n- Fix automatic publication.\n\n" + history;
  const metadata = { version: "1.0.1", date: "2026-11-17", tag: "v1.0.1", repository: "example/package" };
  const prepared = promoteChangelog(input, metadata);
  assert.ok(prepared.includes(history));
  assertChangelog(prepared, "1.0.1");
  assert.equal(promoteChangelog(prepared, metadata), prepared);
  assert.throws(() => promoteChangelog("## [Unreleased]\n\n", metadata), /real notes/u);
  assert.throws(() => promoteChangelog("## [Unreleased]\n\n- (placeholder)\n", metadata), /placeholder/u);
});


test("sealed inventory rejects private paths, oversized input and unsupported modes", () => {
  const verifier = path.join(root, "scripts/verify-public-package.cjs");
  const run = (args, input) => spawnSync(process.execPath, [verifier, ...args], {
    cwd: root, encoding: "utf8", input,
  });
  const privatePath = run(["--inventory-stdin"], "package/legal/signed-clas/SYNTHETIC-RECORD.pdf\n");
  assert.equal(privatePath.status, 1);
  assert.match(privatePath.stderr, /prohibited private artifact/u);
  assert.doesNotMatch(privatePath.stderr, /SYNTHETIC-RECORD/u);
  const oversized = run(["--inventory-stdin"], "a".repeat(16 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /16 MiB/u);
  const unsupported = run(["--unknown-mode"], "");
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /Unsupported/u);
});
