import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parse } from "yaml";
import { configSchema } from "../packages/config.ts";

// Repository Markdown: inline links/images, reference links, and GitHub-style
// ATX heading fragments. External URLs are deliberately not fetched.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
      },
    ).split("\0"),
  ),
].filter((f) => f.endsWith(".md") && existsSync(resolve(root, f)));
const failures: string[] = [];
let checked = 0;
function prose(text: string) {
  let fence: { char: string; length: number } | undefined;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = { char: marker[0], length: marker.length };
        else if (fence.char === marker[0] && marker.length >= fence.length)
          fence = undefined;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}
const anchorCache = new Map<string, Set<string>>();
function anchors(file: string) {
  if (anchorCache.has(file)) return anchorCache.get(file)!;
  const ids = new Set<string>();
  const text = prose(readFileSync(file, "utf8"));
  for (const match of text.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1]
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let id = base;
    for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
  }
  for (const match of text.matchAll(
    /<(?:a|[a-z][\w-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi,
  ))
    ids.add(match[1]);
  anchorCache.set(file, ids);
  return ids;
}
function check(file: string, target: string) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return;
  checked++;
  try {
    const [pathAndQuery, fragment] = target.split("#", 2);
    const path = decodeURIComponent(pathAndQuery.split("?", 1)[0]);
    const absolute = path
      ? resolve(dirname(resolve(root, file)), path)
      : resolve(root, file);
    if (!existsSync(absolute)) throw Error("missing local target");
    if (
      fragment &&
      extname(absolute) === ".md" &&
      statSync(absolute).isFile() &&
      !anchors(absolute).has(decodeURIComponent(fragment))
    )
      throw Error("missing heading/anchor");
  } catch (error) {
    failures.push(`${file}: ${target} — ${(error as Error).message}`);
  }
}
for (const file of files) {
  const text = prose(readFileSync(resolve(root, file), "utf8"));
  const definitions = new Map<string, string>();
  const normalize = (label: string) =>
    label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const m of text.matchAll(
    /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm,
  )) {
    const target = m[2] ?? m[3];
    definitions.set(normalize(m[1]), target);
    check(file, target);
  }
  const body = text
    .replace(/^ {0,3}\[[^\]]+\]:.*$/gm, "")
    .replace(/(`+)[^\n]*?\1/g, "");
  for (const m of body.matchAll(
    /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
  ))
    check(file, m[1] ?? m[2]);
  for (const m of body.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    if (!definitions.has(normalize(m[2] || m[1])))
      failures.push(`${file}: undefined reference [${m[2] || m[1]}]`);
  }
}
try {
  configSchema.parse(
    parse(readFileSync(resolve(root, "config.example.yaml"), "utf8")),
  );
} catch (error) {
  failures.push(
    `config.example.yaml: schema validation failed — ${(error as Error).message}`,
  );
}
if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${files.length} Markdown files and ${checked} local links; example configuration matches the schema.`,
  );
}
