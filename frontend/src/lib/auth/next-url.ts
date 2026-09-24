/** Only same-app paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  return value;
}
