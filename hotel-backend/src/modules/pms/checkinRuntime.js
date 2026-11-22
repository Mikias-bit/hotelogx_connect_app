import { prisma } from '../../config/database.js';
import { createCheckinAutomation } from './checkinAutomation.js';
import { checkinPmsReader } from './checkinPmsReader.js';
import { guestMessagingFor } from './guestMessagingRuntime.js';
import { guestWelcomeFor } from './guestWelcomeRuntime.js';
export const checkinAutomation = createCheckinAutomation({ db: prisma, readerFor: config => checkinPmsReader(prisma, config), messagingFor: () => guestMessagingFor(prisma), welcomeFor: () => guestWelcomeFor(prisma) });
