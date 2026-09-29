/**
 * Only same-app paths are allowed as a post-sign-in destination (no open
 * redirects). Control characters and whitespace are rejected too: a tab or
 * newline smuggled after the leading slash ("/<TAB>/evil.com") slips past
 * the protocol-relative guard, and the browser's URL parser strips it back
 * to "//evil.com" on navigation.
 */
export function safeNext(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    hasControlOrWhitespace(value)
  )
    return "/";
  return value;
}

/** True when any character is a C0 control or ASCII whitespace (code <= 0x20). */
function hasControlOrWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) <= 0x20) return true;
  }
  return false;
}
