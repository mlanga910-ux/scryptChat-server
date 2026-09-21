/**
 * A one-line signal that the local vault changed.
 *
 * The chat used to resolve attachment bytes only when its own list of messages
 * changed, which meant a photo that arrived a moment later could sit on a
 * “loading” placeholder until another message happened to come in. The vault
 * notifies instead, so a bubble sharpens the instant its bytes are stored —
 * no polling, no reload, no lost update.
 */

const VAULT_EVENT = 'scryptchat:vault-change';

export function notifyVaultChange(kind: 'file' | 'message' = 'message'): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(VAULT_EVENT, { detail: { kind } }));
  } catch {
    /* a blocked CustomEvent must never break a transfer */
  }
}

/** Subscribes to vault changes. Returns the unsubscribe function. */
export function onVaultChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(VAULT_EVENT, handler);
  return () => window.removeEventListener(VAULT_EVENT, handler);
}
