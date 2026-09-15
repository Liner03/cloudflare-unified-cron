import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = path.join(root, "packages/contracts");
const sdkRoot = path.join(root, "packages/worker-sdk");
const artifacts = path.join(root, "artifacts");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "unified-cron-sdk-release-"),
);
const contractsBuild = path.join(temporary, "contracts");
const sdkBuild = path.join(temporary, "worker-sdk");
const packageRoot = path.join(temporary, "package");

try {
  const contractsPackage = JSON.parse(
    await fs.readFile(path.join(contractsRoot, "package.json"), "utf8"),
  );
  const sdkPackage = JSON.parse(
    await fs.readFile(path.join(sdkRoot, "package.json"), "utf8"),
  );
  if (contractsPackage.version !== sdkPackage.version) {
    throw new Error("contracts and worker-sdk versions must match");
  }
  const requestedVersion = readVersionArgument(process.argv.slice(2));
  const version = requestedVersion ?? sdkPackage.version;
  if (version !== sdkPackage.version) {
    throw new Error(
      `requested version ${version} does not match package version ${sdkPackage.version}`,
    );
  }

  await Promise.all([
    compile("@unified-cron/contracts", contractsBuild),
    compile("@unified-cron/worker-sdk", sdkBuild),
  ]);

  const dist = path.join(packageRoot, "dist");
  await fs.mkdir(path.join(dist, "contracts"), { recursive: true });
  await copyCompiledFiles(
    contractsBuild,
    path.join(dist, "contracts"),
    addJavaScriptExtensions,
  );
  await copyCompiledFiles(sdkBuild, dist, rewriteSdkImports);
  await fs.copyFile(
    path.join(sdkRoot, "README.md"),
    path.join(packageRoot, "README.md"),
  );
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(releasePackage(version), null, 2)}\n`,
  );

  await assertSelfContained(dist);
  await fs.mkdir(artifacts, { recursive: true });
  const filename = `unified-cron-worker-sdk-${version}.tgz`;
  const tarball = path.join(artifacts, filename);
  await fs.rm(tarball, { force: true });
  await fs.rm(`${tarball}.sha256`, { force: true });
  await exec("pnpm", ["pack", "--pack-destination", artifacts], {
    cwd: packageRoot,
  });
  await verifyArchive(tarball);
  const digest = createHash("sha256")
    .update(await fs.readFile(tarball))
    .digest("hex");
  await fs.writeFile(`${tarball}.sha256`, `${digest}  ${filename}\n`);
  console.log(
    JSON.stringify({
      package: "@unified-cron/worker-sdk",
      version,
      tarball: path.relative(root, tarball),
      checksum: path.relative(root, `${tarball}.sha256`),
    }),
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

async function compile(workspace, outDir) {
  await exec(
    "pnpm",
    [
      "--filter",
      workspace,
      "exec",
      "tsc",
      "-p",
      "tsconfig.build.json",
      "--outDir",
      outDir,
    ],
    { cwd: root },
  );
}

async function copyCompiledFiles(source, destination, transform = identity) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyCompiledFiles(from, to, transform);
      continue;
    }
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) {
      continue;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.writeFile(to, transform(await fs.readFile(from, "utf8")));
  }
}

function rewriteSdkImports(source) {
  return addJavaScriptExtensions(source).replaceAll(
    /(["'])@unified-cron\/contracts\1/g,
    '"./contracts/index.js"',
  );
}

function addJavaScriptExtensions(source) {
  return source.replace(
    /(\bfrom\s+)(["'])(\.\.?\/[^"']+)\2/g,
    (match, prefix, quote, specifier) =>
      /\.(?:js|json)$/.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.js${quote}`,
  );
}

function identity(value) {
  return value;
}

function releasePackage(version) {
  return {
    name: "@unified-cron/worker-sdk",
    version,
    description:
      "Private Cloudflare Service Binding RPC adapter for Unified Cron targets",
    type: "module",
    sideEffects: false,
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./entrypoint": {
        types: "./dist/entrypoint.d.ts",
        import: "./dist/entrypoint.js",
      },
      "./registration": {
        types: "./dist/registration-client.d.ts",
        import: "./dist/registration-client.js",
      },
      "./queue-consumer": {
        types: "./dist/queue-consumer.d.ts",
        import: "./dist/queue-consumer.js",
      },
      "./contracts": {
        types: "./dist/contracts/index.d.ts",
        import: "./dist/contracts/index.js",
      },
    },
    files: ["dist", "README.md"],
    dependencies: {
      zod: "4.5.4",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/Liner03/cloudflare-unified-cron.git",
      directory: "packages/worker-sdk",
    },
    homepage:
      "https://github.com/Liner03/cloudflare-unified-cron/tree/main/packages/worker-sdk",
  };
}

async function assertSelfContained(dist) {
  const files = await allFiles(dist);
  if (!files.some((file) => file.endsWith("/contracts/index.js"))) {
    throw new Error("embedded contracts entrypoint is missing");
  }
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (source.includes("@unified-cron/contracts")) {
      throw new Error(`external contracts import remains in ${file}`);
    }
    if (/(\bfrom\s+)["']\.\.?\/[^"']+(?<!\.js|\.json)["']/.test(source)) {
      throw new Error(`extensionless relative import remains in ${file}`);
    }
  }
}

async function verifyArchive(tarball) {
  const { stdout } = await exec("tar", ["-tzf", tarball]);
  const entries = stdout.trim().split("\n");
  const required = [
    "package/package.json",
    "package/README.md",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/entrypoint.js",
    "package/dist/contracts/index.js",
    "package/dist/contracts/index.d.ts",
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) throw new Error(`archive missing ${entry}`);
  }
  if (entries.some((entry) => entry.includes(".test."))) {
    throw new Error("archive contains test output");
  }
}

async function allFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const value = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await allFiles(value)));
    else result.push(value);
  }
  return result;
}

function readVersionArgument(args) {
  const index = args.indexOf("--version");
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error("--version must be a semantic version");
  }
  return value;
}
