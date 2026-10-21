export function consumerApiHeaders(initial = {}) {
  const headers = new Headers(initial);
  let token = '';
  try { token = localStorage.getItem('bach_device_token') || ''; } catch (_) {}
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}
