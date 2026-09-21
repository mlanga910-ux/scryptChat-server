import { MessageRecord } from '../types/index';

/**
 * Folds an incoming message into the conversation list.
 *
 * A message arrives in pieces over its life: a text message arrives once, but an
 * attachment is announced first (a thumbnail and a placeholder) and its bytes
 * land a moment later under the very same message id. Folding the later record
 * in — instead of ignoring it because the id is already known — is what keeps a
 * photo from sitting on its loading placeholder forever. Merging also keeps a
 * re-delivered message from opening a second bubble next to the original.
 */
export function mergeMessageRow(
  previous: MessageRecord[],
  incoming: MessageRecord
): MessageRecord[] {
  const index = previous.findIndex(
    (existing) =>
      (!!incoming.messageId && existing.messageId === incoming.messageId) ||
      (incoming.id !== undefined && existing.id === incoming.id)
  );

  if (index < 0) return [...previous, incoming];

  const next = [...previous];
  next[index] = { ...next[index], ...incoming };
  return next;
}
