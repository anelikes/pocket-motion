/**
 * The one rule every repo-relative path in a job spec is held to: non-empty,
 * relative, and no `..` segment. `prefix` names the diagnostic family, so a
 * logo, a footage source and a transcript each report under their own key.
 *
 * `src/manifest/sidecar.ts` keeps its own copy on purpose: `tests/catalog.test.ts`
 * reconstructs the sidecar's constructed codes from that file's call sites.
 */
export function pathIssue(
  src: string,
  field: string,
  prefix: string,
): { code: string; message: string } | null {
  if (src.length === 0) {
    return {
      code: `${prefix}.empty`,
      message: `\`${field}\` must be a non-empty relative path`,
    };
  }
  if (src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\")) {
    return {
      code: `${prefix}.absolute`,
      message: `\`${field}\` must be a relative path; got absolute path ${JSON.stringify(src)}`,
    };
  }
  if (src.split(/[/\\]/).some((s) => s === "..")) {
    return {
      code: `${prefix}.traversal`,
      message: `\`${field}\` must not contain \`..\` segments; got ${JSON.stringify(src)}`,
    };
  }
  return null;
}
