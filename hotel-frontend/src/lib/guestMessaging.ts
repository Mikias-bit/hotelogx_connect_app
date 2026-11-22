export interface MessagingInvite {
  id: string; reservationId: string; channel: string; contact: string; status: string;
  createdAt: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null; conversationId: string | null;
}
export interface MessagingConfig { whatsappTemplate: string; whatsappLanguage: string }
export interface MessagingData { config: MessagingConfig; invitations: MessagingInvite[] }
export interface MessagingReservation { reservationId: string; number: string; name: string; room: string | null; arrival: string; departure: string; status: string }
export interface CheckinAutomationData {
  enabled: boolean; channel: string; enterpriseId: string; integrationId: string; serviceId: string;
  lastScannedAt?: string; error?: string;
  jobs: { reservationId: string; status: string; reason: string | null; updatedAt: string }[];
}
export interface WelcomeConfig {
  enabled: boolean; confirmationSender: 'hotelogx' | 'pms'; checkinSender: 'hotelogx' | 'pms';
  arrivalInstructions: string; onlineCheckinUrl: string; catalogueUrl: string; welcomeUpsells: boolean;
  bookingWelcomeTemplate: string; checkinWelcomeTemplate: string;
}
export interface WelcomeData {
  config: WelcomeConfig;
  welcomes: { id: string; reservationId: string; stage: string; channel: string; contact: string; status: string; source: string; createdAt: string }[];
  contacts: { id: string; reservationId: string; channel: string; contact: string; method: string; expiresAt: string }[];
}
