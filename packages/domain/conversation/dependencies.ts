export interface MessageDependency {
  messageId: string;
  sourceId: string;
}
/** Traverse once per node, including indirect replies and cycles. */
export function dependentMessages(
  roots: string[],
  dependencies: MessageDependency[],
): string[] {
  const children = new Map<string, string[]>();
  for (const { messageId, sourceId } of dependencies) {
    const values = children.get(sourceId) ?? [];
    values.push(messageId);
    children.set(sourceId, values);
  }
  const removed = new Set(roots);
  for (const id of removed)
    for (const child of children.get(id) ?? []) removed.add(child);
  return [...removed];
}
