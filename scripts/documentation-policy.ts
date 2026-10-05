// Machine identifiers and endpoint literals are excluded from terminology checks,
// but the English-only language rule includes examples and code-block comments.
export function documentationIssues(source: string): string[] {
  const issues: string[] = [];
  let fence: string | undefined;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const at = `line ${index + 1}`;
    if (/\p{Script=Hangul}/u.test(line))
      issues.push(
        `${at}: documentation must be English; describe localized UI/commands in English and link to the implementation`,
      );
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const prose = line
      .replace(/(`+)[^\n]*?\1/g, "")
      .replace(/https?:\/\/\S+/g, "");
    if (/\bResponses\b(?! API\b)/.test(prose))
      issues.push(`${at}: use the official name Responses API`);
    if (
      /\b(?:ChatGPT OAuth|ChatGPT subscription (?:API|authentication|adapter)|Continue with ChatGPT)\b/i.test(
        prose,
      )
    )
      issues.push(
        `${at}: use Sign in with ChatGPT for authentication, and distinguish ChatGPT plan usage from the Responses API`,
      );
    for (const match of prose.matchAll(/\bsign in with chatgpt\b/gi))
      if (match[0] !== "Sign in with ChatGPT")
        issues.push(
          `${at}: use the official capitalization Sign in with ChatGPT`,
        );
  }
  return issues;
}
