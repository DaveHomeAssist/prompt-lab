// AUD-007: a cheap, synchronous guess at whether Clerk will report a session.
//
// Clerk keeps a readable `__client_uat` cookie (sometimes with a suffix, e.g.
// `__client_uat_AbC123`) holding the last time the client was updated, or "0"
// when no one is signed in. It is only a hint for what to load first: the real
// signed-in state still comes from Clerk, and a wrong guess only changes which
// loading screen shows for a moment.
const CLIENT_UAT_COOKIE = /^__client_uat(?:_[A-Za-z0-9-]+)?$/;

export function hasClerkSessionHint(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const index = part.indexOf('=');
    if (index < 0) return false;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    return CLIENT_UAT_COOKIE.test(name) && value !== '' && value !== '0';
  });
}
