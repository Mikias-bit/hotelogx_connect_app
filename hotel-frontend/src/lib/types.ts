export type Role = "manager" | "front-office" | "housekeeping" | "maintenance";

export type Channel = "whatsapp" | "gmail" | "outlook" | "email";
export type Stage = "pre-arrival" | "in-house" | "post-stay";
export type AiStatus = "ai-handling" | "human-takeover" | "escalated" | "resolved";
export type Sentiment = "positive" | "neutral" | "frustrated" | "urgent";
export type Department =
  | "Front Office"
  | "Housekeeping"
  | "Maintenance"
  | "Guest Request"
  | "VIP"
  | "Billing"
  | "Follow-up";
export type TaskStatus = "New" | "Assigned" | "In Progress" | "Waiting" | "Completed" | "Escalated";
export type Priority = "Urgent" | "High" | "Normal" | "Low";
export type TaskSource =
  | "Guest WhatsApp"
  | "Guest Email"
  | "AI Detection"
  | "Manager"
  | "Front Office"
  | "Housekeeping"
  | "PMS event";

export type RoomStatus =
  | "Dirty"
  | "Cleaning"
  | "Clean"
  | "Inspected"
  | "DND"
  | "Guest Inside"
  | "Maintenance"
  | "Blocked";

export type CleaningType =
  | "Departure"
  | "Stayover"
  | "Stayover + Linen"
  | "VIP Arrival"
  | "Deep Clean"
  | "Turndown";

export interface StaffUser {
  id: string;
  name: string;
  role: Role;
  title: string;
  email: string;
  phone: string;
  initials: string;
  lastActive: string;
  whatsapp: boolean;
}

export interface Reservation {
  number: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  roomType: string;
  status: "Confirmed" | "In House" | "Checked Out" | "Enquiry";
  rate: string;
}

export interface Guest {
  id: string;
  name: string;
  room?: string;
  country: string;
  language: string;
  vip: boolean;
  previousStays: number;
  reservation: Reservation;
  tags: string[];
}

export interface Message {
  id: string;
  author: "guest" | "ai" | "staff" | "system";
  channel: Channel | "internal";
  body: string;
  at: string;
  staffName?: string;
  knowledge?: string[];
  buttons?: string[];
  confidence?: number;
}

export interface Escalation {
  reason: string;
  urgency: Priority;
  suggested: string;
  raisedAt: string;
}

export interface UpsellIdea {
  label: string;
  value: string;
  reason: string;
}

export interface Conversation {
  id: string;
  guest: Guest;
  stage: Stage;
  channels: Channel[];
  primaryChannel: Channel;
  aiStatus: AiStatus;
  sentiment: Sentiment;
  subject: string;
  summary: string;
  suggestedReply: string;
  knowledgeUsed: string[];
  upsellIdeas: UpsellIdea[];
  taskIds: string[];
  escalation?: Escalation;
  messages: Message[];
  unread: number;
  lastAt: string;
  aiHandledCount: number;
  room?: string;
  reservation?: Reservation;
}

export interface Task {
  id: string;
  title: string;
  detail?: string;
  room?: string;
  guest?: string;
  department: Department;
  priority: Priority;
  createdAt: string;
  due?: string;
  assignee?: string;
  status: TaskStatus;
  source: TaskSource;
  conversationId?: string;
  trail: { at: string; text: string; via?: "whatsapp" | "dashboard" | "ai" }[];
}

export interface Room {
  number: string;
  floor: number;
  status: RoomStatus;
  cleaningType: CleaningType;
  guestStatus: string;
  arrivalTime?: string;
  priority: Priority;
  cleaner?: string;
  updatedAt: string;
  vip: boolean;
  note?: string;
  notes?: string[];
  category?: string;
  guest?: string | null;
  guestName?: string;
  earlyCheckIn?: boolean;
}

export interface Issue {
  id: string;
  room: string;
  title: string;
  detail?: string;
  priority: Priority;
  reportedBy: string;
  via: string;
  createdAt: string;
  assignee?: string;
  status: "Open" | "Accepted" | "In Progress" | "Waiting Parts" | "Completed" | "Escalated";
  outOfService: boolean;
  updates: { at: string; text: string; via?: "whatsapp" | "dashboard" }[];
}

export interface Upsell {
  id: string;
  guest: string;
  room?: string;
  offer: string;
  value: number;
  channel: Channel;
  status: "Accepted" | "Sent" | "Declined" | "Expired";
  date: string;
}

export interface KnowledgeDoc {
  id: string;
  name: string;
  category: "Hotel Policies" | "Hotel Information" | "Local Recommendations" | "Upsells";
  format: "PDF" | "DOCX" | "TXT" | "CSV";
  size: string;
  updated: string;
  status: "Indexed" | "Processing" | "Needs Review";
  aiReady: boolean;
  usedToday: number;
}

export interface AiRule {
  topic: string;
  mode: "Autonomous" | "Human Approval" | "Always Escalate";
  note: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: "ai-reply" | "task" | "escalation" | "upsell" | "room" | "maintenance" | "guest";
  text: string;
  meta?: string;
}

export interface WaButton {
  label: string;
}

export interface WaMessage {
  id: string;
  from: "hotelogx" | "staff";
  body: string;
  at: string;
  buttons?: WaButton[];
  chosen?: string;
}

export interface WaThread {
  id: string;
  contact: string;
  role: string;
  phone: string;
  department: "Housekeeping" | "Maintenance" | "Front Office";
  messages: WaMessage[];
}

export interface HotelProfile {
  id?: string;
  name: string;
  legalName: string;
  stars: number;
  rooms: number;
  address: string;
  postcode: string;
  city: string;
  country: string;
  timezone: string;
  currency: string;
  phone: string;
  email: string;
  website: string;
  bookingEngine: string;
  whatsappNumber: string;
  checkIn: string;
  checkOut: string;
  languages: string[];
  vatNumber: string;
  description: string;
}

export type PlanKey = "starter" | "professional" | "enterprise";

export interface PlanTier {
  key: PlanKey;
  name: string;
  pricePerRoom: number;
  blurb: string;
  features: string[];
  seats: number | null;
  knowledgeDocs: number | null;
}

export interface Subscription {
  plan: PlanKey;
  status: "Active" | "Trialing" | "Past Due" | "Cancelled";
  billingCycle: "monthly" | "yearly";
  rooms: number;
  startedOn: string;
  renewsOn: string;
  seatsUsed: number;
  paymentMethod: { brand: string; last4: string; expiry: string; holder: string };
  usage: { conversations: number; aiReplies: number; whatsappMessages: number; upsellRevenue: number };
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  period: string;
  amount: number;
  status: "Paid" | "Open" | "Failed";
}

/* ----------------------------------------------------------- onboarding -- */

export type OnboardingStepKey =
  | "profile"
  | "pms"
  | "email"
  | "wa-guest"
  | "wa-internal"
  | "knowledge"
  | "users"
  | "ai";

export type ConnectionState = "not-started" | "in-progress" | "connected" | "error";

export type EmailMethod = "oauth" | "credentials" | "manual";

export type WaTopology = "separate" | "single" | "guest-only";

export type WaConnectionType = "guest" | "internal";

export interface EmailServerSettings {
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
}

export interface EmailDetection {
  domain: string;
  provider: string;
  providerName: string;
  method: EmailMethod;
  mx: string[];
  checks: { incoming: boolean; outgoing: boolean; security: boolean };
  settings: EmailServerSettings | null;
  autodiscover: { srv: boolean; https: boolean } | null;
  note: string | null;
  /** how the answer was reached — mx lookup, autodiscovery, nothing, or a local guess */
  source: "mx" | "autodiscover" | "none" | "offline";
}

export interface EmailConnection {
  state: ConnectionState;
  address: string;
  detection: EmailDetection | null;
  method: EmailMethod | null;
  settings: EmailServerSettings | null;
  connectedAt: string | null;
  lastMessage: string | null;
  error: string | null;
}

/** The identifiers Meta hands back after Embedded Signup. */
export interface WaConnection {
  state: ConnectionState;
  connectionType: WaConnectionType;
  hotelId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  canSend: boolean;
  canReceive: boolean;
  lastActivity: string | null;
  error: string | null;
}

export interface PmsConnection {
  state: ConnectionState;
  provider: string | null;
  propertyId: string | null;
  propertyName: string | null;
  lastSync: string | null;
  error: string | null;
}

export interface OnboardingInvite {
  email: string;
  role: Role;
}

export interface OnboardingState {
  complete: boolean;
  startedAt: string | null;
  waTopology: WaTopology | null;
  done: Record<OnboardingStepKey, boolean>;
  pms: PmsConnection;
  email: EmailConnection;
  waGuest: WaConnection;
  waInternal: WaConnection;
  invites: OnboardingInvite[];
}

export interface MewsEnterpriseConfig {
  id: string;
  name: string;
  currencies: string[];
  timeZoneIdentifier: string;
}

export interface MewsSpace {
  id: string;
  number: string;
  floor: number;
  category: string;
  status: RoomStatus;
  occupied: boolean;
}

export interface MewsReservation {
  id: string;
  number: string;
  guestName: string;
  assignedSpaceId?: string;
  roomNumber?: string;
  startUtc: string;
  endUtc: string;
  adultCount: number;
  childCount: number;
  rateString: string;
  status: string;
  isVip: boolean;
}

export interface MewsFolio {
  reservationNumber: string;
  room: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  category: string;
  rate: string;
  status: string;
}

