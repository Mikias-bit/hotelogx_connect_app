import type { Conversation, Message, Task } from './types';

export function timestamp(value?: string): number {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) || 0 : 0;
}
export function messageTime(message: Message): number {
  return timestamp(message.at) || timestamp(message.createdAt);
}
export function conversationTime(conversation: Conversation): number {
  return Math.max(timestamp(conversation.lastAt), ...conversation.messages.map(messageTime), 0);
}
export function dateLabel(value?: string, timezone?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!timestamp(value)) return value ? `${value} (date unavailable)` : 'Date unavailable';
  return new Date(value!).toLocaleString(undefined, { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function completedToday(task: Task, timezone: string, now = new Date()): boolean {
  if (task.status !== 'Completed' || !timestamp(task.completedAt)) return false;
  const date = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: timezone });
  return date(new Date(task.completedAt!)) === date(now);
}
