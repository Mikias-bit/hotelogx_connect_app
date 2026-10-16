import type {
  ActivityItem,
  AiRule,
  Conversation,
  Guest,
  HotelProfile,
  Invoice,
  Issue,
  KnowledgeDoc,
  PlanTier,
  Room,
  StaffUser,
  Subscription,
  Task,
  Upsell,
  WaThread,
} from "./types";

export const hotel: HotelProfile = {
  name: "Hotel Mercier",
  legalName: "Hotel Mercier BV",
  stars: 4,
  rooms: 48,
  address: "Leopoldstraat 42",
  postcode: "2000",
  city: "Antwerp",
  country: "Belgium",
  timezone: "Europe/Brussels",
  currency: "€",
  phone: "+32 3 227 41 00",
  email: "reception@hotelmercier.be",
  website: "hotelmercier.be",
  bookingEngine: "hotelmercier.be/book",
  whatsappNumber: "+32 3 227 41 08",
  checkIn: "15:00",
  checkOut: "11:00",
  languages: ["Dutch", "French", "English", "German"],
  vatNumber: "BE 0784.512.339",
  description:
    "A 48-room townhouse hotel in the fashion district, five minutes from Antwerp Central. Courtyard-facing Deluxe rooms, a small spa and a breakfast room that opens at 07:00.",
};

export const staff: StaffUser[] = [
  {
    id: "u-jonas",
    name: "Jonas Verhaeghe",
    role: "manager",
    title: "General Manager",
    email: "jonas@hotelmercier.be",
    phone: "+32 478 20 11 46",
    initials: "JV",
    lastActive: "now",
    whatsapp: true,
  },
  {
    id: "u-amelie",
    name: "Amélie Duprez",
    role: "front-office",
    title: "Front Office Agent",
    email: "amelie@hotelmercier.be",
    phone: "+32 471 55 09 32",
    initials: "AD",
    lastActive: "2 min ago",
    whatsapp: true,
  },
  {
    id: "u-rosa",
    name: "Rosa Ferreira",
    role: "housekeeping",
    title: "Housekeeping Manager",
    email: "rosa@hotelmercier.be",
    phone: "+32 465 88 12 70",
    initials: "RF",
    lastActive: "14 min ago",
    whatsapp: true,
  },
  {
    id: "u-peter",
    name: "Peter Janssens",
    role: "maintenance",
    title: "Technical Manager",
    email: "peter@hotelmercier.be",
    phone: "+32 494 31 62 18",
    initials: "PJ",
    lastActive: "6 min ago",
    whatsapp: true,
  },
  {
    id: "u-thibault",
    name: "Thibault Mertens",
    role: "front-office",
    title: "Night Auditor",
    email: "thibault@hotelmercier.be",
    phone: "+32 472 14 88 03",
    initials: "TM",
    lastActive: "yesterday 23:40",
    whatsapp: false,
  },
];

export const cleaners = ["Maria Silva", "Inês Duarte", "Kadir Yılmaz", "Alina Popescu"];
export const technicians = ["Peter Janssens", "Milan Novák"];

export const guests: Record<string, Guest> = {};

export const seedConversations: Conversation[] = [];

export const seedTasks: Task[] = [];

export const seedRooms: Room[] = [];

export const seedIssues: Issue[] = [];

export const seedUpsells: Upsell[] = [];

export const knowledgeDocs: KnowledgeDoc[] = [];

export const planTiers: PlanTier[] = [
  {
    key: "starter",
    name: "Starter",
    pricePerRoom: 4,
    blurb: "One channel, the knowledge base and the AI inbox. For small properties testing the water.",
    features: [
      "WhatsApp or email — one channel",
      "AI answers from your knowledge base",
      "Up to 25 knowledge sources",
      "Guest request tasks",
      "Email support",
    ],
    seats: 5,
    knowledgeDocs: 25,
  },
  {
    key: "professional",
    name: "Professional",
    pricePerRoom: 7,
    blurb: "Every channel, the PMS connection and the full operations layer on WhatsApp.",
    features: [
      "WhatsApp and email together",
      "PMS connection — availability, rates, folios",
      "Housekeeping and maintenance on WhatsApp",
      "Upsell engine and revenue reporting",
      "Unlimited knowledge sources",
      "Priority support",
    ],
    seats: 25,
    knowledgeDocs: null,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    pricePerRoom: 11,
    blurb: "Multi-property, custom integrations and a named account manager.",
    features: [
      "Everything in Professional",
      "Multiple properties on one account",
      "Custom PMS and POS integrations",
      "Single sign-on and audit export",
      "Named account manager",
      "99.9% uptime commitment",
    ],
    seats: null,
    knowledgeDocs: null,
  },
];

export const subscription: Subscription = {
  plan: "professional",
  status: "Active",
  billingCycle: "monthly",
  rooms: 48,
  startedOn: "14 Feb 2026",
  renewsOn: "14 Sep 2026",
  seatsUsed: 5,
  paymentMethod: { brand: "Visa", last4: "4417", expiry: "09/28", holder: "Hotel Mercier BV" },
  usage: { conversations: 0, aiReplies: 0, whatsappMessages: 0, upsellRevenue: 0 },
};

export const invoices: Invoice[] = [];

export const aiRules: AiRule[] = [
  { topic: "General questions", mode: "Autonomous", note: "Wi-Fi, directions, opening hours" },
  { topic: "Hotel information", mode: "Autonomous", note: "Answered from the knowledge base" },
  { topic: "Availability & pricing", mode: "Autonomous", note: "Reads Mews, never books" },
  { topic: "Upsells", mode: "Autonomous", note: "Only offers from the priced catalogue" },
  { topic: "Housekeeping requests", mode: "Autonomous", note: "Creates tasks and confirms to the guest" },
  { topic: "Maintenance reports", mode: "Autonomous", note: "Opens a ticket, notifies the technician" },
  { topic: "Late checkout / early check-in", mode: "Human Approval", note: "Depends on occupancy" },
  { topic: "Complaints", mode: "Human Approval", note: "AI drafts, a human sends" },
  { topic: "Refunds", mode: "Always Escalate", note: "Never handled by AI" },
  { topic: "Billing disputes", mode: "Always Escalate", note: "Folio pulled and attached" },
  { topic: "Safety issues", mode: "Always Escalate", note: "Duty manager notified immediately" },
  { topic: "VIP guests", mode: "Human Approval", note: "AI prepares, staff confirms" },
];

export const seedActivity: ActivityItem[] = [];

export const seedWaThreads: WaThread[] = [];

export const conversationTrend = [42, 51, 47, 58, 63, 71, 63];
export const aiTrend = [79, 82, 81, 85, 84, 88, 87];
export const upsellTrend = [186, 240, 312, 205, 388, 332, 284.5];
export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
