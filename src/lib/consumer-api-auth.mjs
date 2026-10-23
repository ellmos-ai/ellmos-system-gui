export function consumerApiHeaders(initial = {}) {
  // Same-origin consumer requests use the browser-managed session cookie.
  // Preserve explicit caller headers, including temporary operator authority.
  return new Headers(initial);
}
