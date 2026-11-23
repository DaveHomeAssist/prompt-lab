// Flag-off stand-in for the account sync hook. The hosted /app build uses this
// unless VITE_PL_ACCOUNT_SYNC=on, so that build does not include the sync client.
const IDLE = Object.freeze({
  status: 'off',
  pending: 0,
  enabled: false,
  signedIn: false,
  keptSeparate: false,
});

export default function useAccountSync() {
  return IDLE;
}
