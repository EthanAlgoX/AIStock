/** Allow only app-relative destinations when returning from authentication. */
export function getLoginRedirect(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')
    && !Array.from(raw).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    && !raw.startsWith('/login') && raw !== '/'
    ? raw
    : '/overview';
}
