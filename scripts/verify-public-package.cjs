#!/usr/bin/env node
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  collectRepositoryArtifactPaths, comparePackageArtifactAllowlist,
  findPackageFilesPolicyViolations, findPrivateArtifactViolations,
} = require("./private-artifact-policy.cjs");
const { files: EXPECTED_PACKAGE_FILES, paths: EXPECTED_PACKED_PATHS } = require("./package-artifacts.json");

function main() {
  if (verifyReleaseInputs(process.argv.slice(2))) return;
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
  );
  const declarationPath = packageJson.types;
  if (
    typeof declarationPath !== "string" ||
    !declarationPath.startsWith("./") ||
    !packageJson.exports?.["."]?.types ||
    packageJson.exports["."].types !== declarationPath
  ) {
    throw new Error("Public package must expose a matching root types entry and types export.");
  }

  const cacheDir = path.resolve(process.cwd(), ".npm-cache-packcheck");
  const output = execSync(
    `npm pack --dry-run --json --ignore-scripts --cache "${cacheDir}"`,
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const parsed = parseNpmPackJson(output);
  const files = Array.isArray(parsed) && parsed[0]?.files ? parsed[0].files : [];
  const paths = files.map((entry) => entry.path);
  verifyPackagePathInventory(paths);

  const packedDeclarationPath = declarationPath.slice(2);
  if (!paths.includes(packedDeclarationPath)) {
    console.error(
      `Public package check failed. Type declaration is not packed: ${packedDeclarationPath}`
    );
    process.exit(1);
  }

  const forbiddenTarballPathPatterns = [
    {
      label: "private monorepo path",
      regex: /(?:^|\/)plasius-ltd-site(?:\/|$)/i,
    },
    {
      label: "private app runtime path",
      regex: /(?:^|\/)(frontend|backend|dashboard|infra)(?:\/|$)/i,
    },
    {
      label: "local settings artifact",
      regex: /(?:^|\/)local\.settings(?:\.[^/]+)?\.json$/i,
    },
    {
      label: "azure host artifact",
      regex: /(?:^|\/)host\.json$/i,
    },
    {
      label: "generated tsp artifact",
      regex: /(?:^|\/)tsp-output(?:\/|$)/i,
    },
  ];

  const forbiddenPaths = paths.filter((filePath) =>
    forbiddenTarballPathPatterns.some(({ regex }) => regex.test(filePath))
  );

  if (forbiddenPaths.length > 0) {
    console.error("Public package check failed. Forbidden publish paths found:");
    for (const filePath of forbiddenPaths) {
      console.error(`- ${filePath}`);
    }
    process.exit(1);
  }

  const forbiddenCodeReferencePatterns = [
    {
      label: "private monorepo reference",
      regex: /\bplasius-ltd-site\b/i,
    },
    {
      label: "Plasius Ltd private reference",
      regex: /\bplasius(?:\s+|-)ltd\b/i,
    },
    {
      label: "proprietary PGP artifact reference",
      regex: /\bpgp[-_a-z0-9]*\b/i,
    },
    {
      label: "proprietary Lunari artifact reference",
      regex: /\blunari\b/i,
    },
    {
      label: "proprietary Pixelverse artifact reference",
      regex: /\bpixelverse\b/i,
    },
  ];

  const codeRoots = ["src", "tests", "demo"];
  const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);
  const violations = scanCodeReferences(
    codeRoots,
    codeExtensions,
    forbiddenCodeReferencePatterns
  );

  if (violations.length > 0) {
    console.error(
      "Public package check failed. Forbidden private/product code references found:"
    );
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} (${violation.label})`);
    }
    process.exit(1);
  }

  console.log("Public package check passed.");
}

function parseNpmPackJson(rawOutput) {
  const start = rawOutput.indexOf("[");
  const end = rawOutput.lastIndexOf("]");

  if (start < 0 || end < start) {
    throw new Error("Could not find npm pack JSON payload in command output.");
  }

  const jsonSlice = rawOutput.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}

function scanCodeReferences(roots, extensions, patterns) {
  const allFiles = [];
  for (const root of roots) {
    allFiles.push(...collectFiles(path.resolve(process.cwd(), root), extensions));
  }

  const violations = [];
  for (const file of allFiles) {
    const contents = fs.readFileSync(file, "utf8");

    for (const pattern of patterns) {
      const matchIndex = contents.search(pattern.regex);
      if (matchIndex < 0) {
        continue;
      }

      const beforeMatch = contents.slice(0, matchIndex);
      const line = beforeMatch.split(/\r?\n/u).length;
      violations.push({
        file: path.relative(process.cwd(), file),
        line,
        label: pattern.label,
      });
      break;
    }
  }

  return violations;
}

function collectFiles(root, extensions) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-cjs") {
        continue;
      }
      files.push(...collectFiles(fullPath, extensions));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}


function verifyPackagePathInventory(paths) {
  const violations = findPrivateArtifactViolations(paths);
  if (violations.length) {
    throw new Error("Packed output contains prohibited private artifact path metadata; values were not logged.");
  }
  const inventory = comparePackageArtifactAllowlist(paths, EXPECTED_PACKED_PATHS);
  if (inventory.missingPaths.length || inventory.unexpectedPaths.length) {
    throw new Error(`Packed paths differ from the exact allowlist (${inventory.missingPaths.length} missing, ${inventory.unexpectedPaths.length} unexpected); values were not logged.`);
  }
}

function verifyReleaseInputs(argv) {
  if (argv.length === 1 && argv[0] === "--inventory-stdin") {
    const input = fs.readFileSync(0);
    if (input.byteLength > 16 * 1024 * 1024) throw new Error("Packed path inventory exceeds the 16 MiB limit.");
    verifyPackagePathInventory(input.toString("utf8").split("\n").filter((entry) => entry.length > 0));
    console.log("Sealed package inventory check passed.");
    return true;
  }
  if (argv.length) throw new Error("Unsupported public package check arguments.");
  let repositoryPaths;
  try { repositoryPaths = collectRepositoryArtifactPaths(process.cwd()); }
  catch { throw new Error("Repository path metadata could not be evaluated; details were not logged."); }
  if (findPrivateArtifactViolations(repositoryPaths).length) {
    throw new Error("Prohibited private artifact path metadata was found; values were not logged.");
  }
  const metadata = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  if (findPackageFilesPolicyViolations(metadata.files, EXPECTED_PACKAGE_FILES).length) {
    throw new Error("package.json files policy failed; values were not logged.");
  }
  return false;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.code ? "Public package check failed; details were not logged." : error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(path.resolve(process.cwd(), ".npm-cache-packcheck"), { recursive: true, force: true });
  }
}
module.exports = { EXPECTED_PACKED_PATHS, verifyPackagePathInventory };
