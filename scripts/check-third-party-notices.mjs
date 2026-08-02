import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

const runtimePackages = new Map();

for (const [installPath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!installPath || !metadata.version || metadata.dev) continue;

  const marker = "node_modules/";
  const packageName = installPath.slice(installPath.lastIndexOf(marker) + marker.length);
  const key = `${packageName}@${metadata.version}`;
  runtimePackages.set(key, {
    name: packageName,
    version: metadata.version,
    license: metadata.license,
  });
}

const missing = [];
const mismatched = [];

for (const dependency of [...runtimePackages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  const inventoryRow = `| \`${dependency.name}\` | \`${dependency.version}\` | \`${dependency.license}\` |`;
  const noticeEntry = `\`${dependency.name}@${dependency.version}\``;

  if (!notices.includes(inventoryRow)) mismatched.push(inventoryRow);
  if (!notices.includes(noticeEntry)) missing.push(noticeEntry);
}

if (missing.length || mismatched.length) {
  if (missing.length) {
    console.error(`Missing license notice entries:\n${missing.join("\n")}`);
  }
  if (mismatched.length) {
    console.error(`Missing or stale inventory rows:\n${mismatched.join("\n")}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Third-party notices cover ${runtimePackages.size} locked runtime package versions.`);
}
