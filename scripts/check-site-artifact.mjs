import { readdir, readFile } from "node:fs/promises";

const siteRoot = new URL("../dist/site/", import.meta.url);
const sourceLicense = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const sourceNotices = await readFile(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  "utf8",
);

const files = await listFiles(siteRoot);
const requiredPaths = [
  "index.html",
  "guides/github-actions-matrix-cost.html",
  "guides/github-actions-macos-cost-regression.html",
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.md",
];
const missingPaths = requiredPaths.filter((path) => !files.includes(path));

if (missingPaths.length) {
  throw new Error(`Site artifact is missing: ${missingPaths.join(", ")}`);
}

if (files.some((path) => path.endsWith(".map"))) {
  throw new Error("Site artifact must not publish source maps.");
}

const deployedLicense = await readFile(new URL("LICENSE.txt", siteRoot), "utf8");
const deployedNotices = await readFile(new URL("THIRD_PARTY_NOTICES.md", siteRoot), "utf8");

if (deployedLicense !== sourceLicense || deployedNotices !== sourceNotices) {
  throw new Error("Site artifact legal notices do not match their reviewed sources.");
}

const javascriptPaths = files.filter((path) => path.endsWith(".js"));
const javascript = (
  await Promise.all(javascriptPaths.map((path) => readFile(new URL(path, siteRoot), "utf8")))
).join("\n");

const prohibitedRuntimeMarkers = [
  ["network request", /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/],
  ["browser persistence", /localStorage|sessionStorage|document\.cookie/],
  ["Vite modulepreload polyfill", /modulepreload|MutationObserver/],
  ["local build path", /\/Users\/|[A-Z]:\\\\Users\\\\/],
  ["credential-like value", /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|gh[pousr]_[A-Za-z0-9_]{20,}/],
];

for (const [description, pattern] of prohibitedRuntimeMarkers) {
  if (pattern.test(javascript)) {
    throw new Error(`Site artifact contains a prohibited ${description} marker.`);
  }
}

console.log(
  `Site artifact passed: ${files.length} files, ${javascriptPaths.length} JavaScript bundle, local-only runtime.`,
);

async function listFiles(directoryUrl, prefix = "") {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(new URL(`${entry.name}/`, directoryUrl), `${relativePath}/`)));
    } else {
      paths.push(relativePath);
    }
  }

  return paths.sort();
}
