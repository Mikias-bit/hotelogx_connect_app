export type Shift = 'Morning' | 'Evening' | 'Night';
export interface ShiftHandover {
  id: string; shiftDate: string; shift: Shift; targetDate: string; targetShift: Shift;
  title: string; body: string; room?: string; priority: 'Normal' | 'High' | 'Urgent';
  status: 'Open' | 'Acknowledged' | 'Completed'; authorName: string; createdAt: string; version: number;
  events: { action: string; actorName: string; at: string; note?: string }[];
}
export interface HandoverInput {
  shiftDate: string; shift: Shift; title: string; body: string; room: string; priority: string;
}
