/**
 * Removes credentials embedded in URLs (scheme://user:pass@host) from free
 * text such as driver error messages, before the text is logged or stored.
 */
export function stripUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@');
}
