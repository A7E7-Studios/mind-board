// Rebuild redistribution notices from the exact installed/locked dependencies.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--format-version",
      "1",
      "--locked",
      "--offline",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
  ),
);
const sections = [
  "MindBoard — third-party dependency notices\n\nMindBoard source is MIT licensed. Third-party components retain their own licenses.\nThis inventory includes Rust build/test dependencies as well as runtime components.\nWebView2 is a separately installed Microsoft runtime and is not bundled in the standalone application.",
];
const missing = [];
const licenseTexts = new Map();
function register(contents) {
  const text = contents
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .trim();
  if (!licenseTexts.has(text))
    licenseTexts.set(text, `L${licenseTexts.size + 1}`);
  return `See license text ${licenseTexts.get(text)} below.`;
}
for (const pkg of metadata.packages.sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!pkg.source) continue;
  const directory = dirname(pkg.manifest_path);
  const names = new Set(
    readdirSync(directory).filter((name) =>
      /^(licen[sc]e|copying|copyright|notice)([._-]|$)/i.test(name),
    ),
  );
  if (pkg.license_file) names.add(pkg.license_file);
  const texts = [];
  for (const name of names) {
    try {
      texts.push(
        `${name}: ${register(readFileSync(join(directory, name), "utf8"))}`,
      );
    } catch {
      /* Some crates use a license directory. */
    }
  }
  if (!texts.length)
    missing.push(
      `${pkg.name} ${pkg.version} (${pkg.license ?? "unspecified"})`,
    );
  sections.push(
    `${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? "See included license"}\nSource: ${pkg.repository ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`}\n\n${texts.join("\n\n") || "This crate does not ship a separate license text; refer to its source repository and declared license above."}`,
  );
}
const api = JSON.parse(
  readFileSync("node_modules/@tauri-apps/api/package.json", "utf8"),
);
const apiLicenses = [
  "LICENSE",
  "LICENSE-MIT",
  "LICENSE_MIT",
  "LICENSE_APACHE-2.0",
  "LICENSE-MIT.txt",
].filter((name) => existsSync(`node_modules/@tauri-apps/api/${name}`));
sections.push(
  `@tauri-apps/api ${api.version}\nLicense: ${api.license}\nSource: https://github.com/tauri-apps/tauri\n\n${apiLicenses.map((name) => `${name}: ${register(readFileSync(`node_modules/@tauri-apps/api/${name}`, "utf8"))}`).join("\n")}`,
);
for (const [text, id] of licenseTexts)
  sections.push(`LICENSE TEXT ${id}\n\n${text}`);
writeFileSync(
  "THIRD_PARTY_NOTICES.txt",
  sections.join("\n\n" + "=".repeat(78) + "\n\n") + "\n",
);
console.log(
  `Wrote notices for ${metadata.packages.length - 1} Rust crates and @tauri-apps/api.`,
);
if (missing.length)
  console.log(
    `Crates whose license text is available upstream: ${missing.join(", ")}`,
  );
