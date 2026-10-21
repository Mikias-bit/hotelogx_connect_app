import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { inviteStaff } from '../users/invitationService.js';
import { encryptToken } from '../../utils/tokenCrypto.js';

// Columns are provisioned by Prisma migrations before deployment.
export async function ensureWhatsAppColumns() {}
async function ensureHotelColumns() {}

export const getOnboardingStatus = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) return errorResponse(res, 'Hotel entity not found', 404);

    let stepsDone = ['profile'];
    if (hotel?.onboardingSteps) {
      try {
        stepsDone = JSON.parse(hotel.onboardingSteps);
      } catch {
        stepsDone = ['profile'];
      }
    }

    const targetHotelId = hotel.id;

    // Check real active integrations from database
    const [pmsInteg, emailInteg, waIntegs] = await Promise.all([
      prisma.pmsIntegration.findUnique({ where: { hotelId: targetHotelId } }).catch(() => null),
      prisma.emailIntegration.findUnique({ where: { hotelId: targetHotelId } }).catch(() => null),
      prisma.whatsAppIntegration.findMany({ where: { hotelId: targetHotelId, status: 'connected' } }).catch(() => []),
    ]);

    const isPmsConnected = pmsInteg?.status === 'connected';
    const isEmailConnected = emailInteg?.status === 'connected';
    const hasWaGuest = waIntegs.some((w) => w.targetType === 'guest' || w.targetType === 'both');
    const hasWaInternal = waIntegs.some((w) => w.targetType === 'internal' || w.targetType === 'both');

    if (isPmsConnected && !stepsDone.includes('pms')) stepsDone.push('pms');
    if (isEmailConnected && !stepsDone.includes('email')) stepsDone.push('email');
    if (hasWaGuest && !stepsDone.includes('wa-guest')) stepsDone.push('wa-guest');
    if (hasWaInternal && !stepsDone.includes('wa-internal')) stepsDone.push('wa-internal');

    const doneMap = {
      profile: stepsDone.includes('profile'),
      pms: isPmsConnected || stepsDone.includes('pms'),
      email: isEmailConnected || stepsDone.includes('email'),
      'wa-guest': hasWaGuest || stepsDone.includes('wa-guest'),
      'wa-internal': hasWaInternal || stepsDone.includes('wa-internal'),
      knowledge: stepsDone.includes('knowledge'),
      users: stepsDone.includes('users'),
      ai: stepsDone.includes('ai'),
    };

    // Synchronize OnboardingState table
    prisma.onboardingState.upsert({
      where: { hotelId: targetHotelId },
      update: {
        pmsDone: doneMap.pms,
        emailDone: doneMap.email,
        guestWaDone: doneMap['wa-guest'],
        internalWaDone: doneMap['wa-internal'],
        kbDone: doneMap.knowledge,
        usersDone: doneMap.users,
        aiDone: doneMap.ai,
      },
      create: {
        hotelId: targetHotelId,
        pmsDone: doneMap.pms,
        emailDone: doneMap.email,
        guestWaDone: doneMap['wa-guest'],
        internalWaDone: doneMap['wa-internal'],
        kbDone: doneMap.knowledge,
        usersDone: doneMap.users,
        aiDone: doneMap.ai,
      },
    }).catch(() => {});

    const profile = {
      name: hotel?.name || 'My Hotel',
      legalName: hotel?.legalName || `${hotel?.name || 'My Hotel'} BV`,
      stars: Number(hotel?.stars) || 4,
      rooms: Number(hotel?.roomsCount) || 0,
      address: hotel?.address || '',
      postcode: hotel?.postcode || '',
      city: hotel?.city || '',
      country: hotel?.country || '',
      phone: hotel?.phone || '',
      email: hotel?.email || '',
      website: hotel?.website || '',
      bookingEngine: hotel?.bookingEngine || '',
      whatsappNumber: hotel?.whatsappNumber || '',
      checkIn: hotel?.checkIn || '15:00',
      checkOut: hotel?.checkOut || '11:00',
      languages: ['Dutch', 'French', 'English', 'German'],
      description: hotel?.description || '',
    };

    return successResponse(res, {
      hotelId: targetHotelId,
      waTopology: hotel?.waTopology || 'separate',
      complete: Boolean(hotel?.onboardingDone),
      done: doneMap,
      hotelProfile: profile,
      emailIntegration: emailInteg && isEmailConnected ? {
        email: emailInteg.email,
        provider: emailInteg.provider,
        status: emailInteg.status,
        lastSyncAt: emailInteg.lastSyncAt,
      } : null,
    }, 'Onboarding status fetched');
  } catch (error) {
    next(error);
  }
};

export const getHotelProfile = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) return errorResponse(res, 'Hotel entity not found', 404);

    const profile = {
      name: hotel?.name || 'My Hotel',
      legalName: hotel?.legalName || `${hotel?.name || 'My Hotel'} BV`,
      stars: Number(hotel?.stars) || 4,
      rooms: Number(hotel?.roomsCount) || 0,
      address: hotel?.address || '',
      postcode: hotel?.postcode || '',
      city: hotel?.city || '',
      country: hotel?.country || '',
      phone: hotel?.phone || '',
      email: hotel?.email || '',
      website: hotel?.website || '',
      bookingEngine: hotel?.bookingEngine || '',
      whatsappNumber: hotel?.whatsappNumber || '',
      checkIn: hotel?.checkIn || '15:00',
      checkOut: hotel?.checkOut || '11:00',
      languages: ['Dutch', 'French', 'English', 'German'],
      description: hotel?.description || '',
    };

    return successResponse(res, profile, 'Hotel profile fetched');
  } catch (error) {
    next(error);
  }
};

export const saveHotelProfile = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);

    const data = req.body;
    if (!data) {
      return errorResponse(res, 'Profile data required', 400);
    }

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
    const targetHotelId = hotelId;

    let stepsDone = ['profile'];
    if (hotel?.onboardingSteps) {
      try {
        stepsDone = JSON.parse(hotel.onboardingSteps);
      } catch {
        stepsDone = ['profile'];
      }
    }
    if (!stepsDone.includes('profile')) {
      stepsDone.push('profile');
    }

    if (hotel) {
      await prisma.hotel.update({
        where: { id: targetHotelId },
        data: {
          name: data.name ?? hotel.name,
          legalName: data.legalName ?? hotel.legalName,
          stars: Number(data.stars) || hotel.stars || 4,
          roomsCount: Number(data.rooms || data.roomsCount) || hotel.roomsCount || 0,
          address: data.address ?? hotel.address,
          postcode: data.postcode ?? hotel.postcode,
          city: data.city ?? hotel.city,
          country: data.country ?? hotel.country,
          phone: data.phone ?? hotel.phone,
          email: data.email ?? hotel.email,
          website: data.website ?? hotel.website,
          checkIn: data.checkIn ?? hotel.checkIn ?? '15:00',
          checkOut: data.checkOut ?? hotel.checkOut ?? '11:00',
          description: data.description ?? hotel.description ?? '',
          onboardingSteps: JSON.stringify(stepsDone),
        },
      });
    } else {
      await prisma.hotel.create({
        data: {
          id: targetHotelId,
          name: data.name || 'My Hotel',
          legalName: data.legalName || `${data.name || 'My Hotel'} BV`,
          stars: Number(data.stars) || 4,
          roomsCount: Number(data.rooms || data.roomsCount) || 0,
          address: data.address || '',
          postcode: data.postcode || '',
          city: data.city || '',
          country: data.country || '',
          phone: data.phone || '',
          email: data.email || '',
          website: data.website || '',
          bookingEngine: data.bookingEngine || '',
          whatsappNumber: data.whatsappNumber || '',
          checkIn: data.checkIn || '15:00',
          checkOut: data.checkOut || '11:00',
          vatNumber: data.vatNumber || '',
          description: data.description || '',
          onboardingSteps: JSON.stringify(stepsDone),
        },
      });
    }

    return successResponse(res, {
      profile: data,
      onboardingSteps: stepsDone,
      done: true,
    }, 'Hotel profile saved successfully');
  } catch (error) {
    next(error);
  }
};

export const saveTopology = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { topology } = req.body;

    if (!topology) {
      return errorResponse(res, 'Topology choice is required', 400);
    }

    await prisma.hotel.update({
      where: { id: hotelId },
      data: { waTopology: topology },
    }).catch(() => {});

    return successResponse(res, { waTopology: topology }, 'WhatsApp topology saved');
  } catch (error) {
    next(error);
  }
};

export const saveOnboardingStep = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { stepKey, data } = req.body;
    if (stepKey === 'email') {
      if (req.user?.role !== 'manager') return errorResponse(res,'Hotel manager access required',403);
      const integration=await prisma.emailIntegration.findUnique({ where:{ hotelId } });
      const address=String(data?.address || data?.email || '').trim().toLowerCase();
      const oauth=data?.method==='oauth';
      if (!integration || integration.status!=='connected' || integration.email.toLowerCase()!==address ||
          (oauth ? !['google','microsoft'].includes(integration.provider) || !integration.accessToken : !['credentials','hostinger'].includes(integration.provider) || !integration.mailVerifiedAt)) {
        return errorResponse(res,'Verify and connect this mailbox before completing onboarding',409);
      }
      // OAuth callbacks and IMAP connection service already commit completion atomically.
      // This endpoint must never save unverified passwords or replace server settings.
      return successResponse(res,{ stepKey,email:integration.email,provider:integration.provider },'Verified email step saved');
    }
    if (stepKey === 'users' && (data?.email || data?.address)) {
      const user = await inviteStaff(req.user, data);
      const currentHotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
      let done = [];
      try { done = JSON.parse(currentHotel?.onboardingSteps || '[]'); } catch {}
      if (!Array.isArray(done)) done = [];
      if (!done.includes('users')) done.push('users');
      await prisma.$transaction([
        prisma.hotel.update({ where: { id: hotelId }, data: { onboardingSteps: JSON.stringify(done) } }),
        prisma.onboardingState.upsert({ where: { hotelId }, update: { usersDone: true }, create: { hotelId, usersDone: true } }),
      ]);
      return successResponse(res, { stepKey, user, email: user.email, role: user.role }, 'Invitation accepted by email provider');
    }

    if (!stepKey) {
      return errorResponse(res, 'Step key is required', 400);
    }

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });

    let stepsDone = ['profile'];
    if (hotel?.onboardingSteps) {
      try {
        stepsDone = JSON.parse(hotel.onboardingSteps);
      } catch {
        stepsDone = ['profile'];
      }
    }
    if (!stepsDone.includes(stepKey)) {
      stepsDone.push(stepKey);
    }

    // Keep OnboardingState table in sync with step progression
    const stepFieldMap = {
      pms: 'pmsDone',
      email: 'emailDone',
      'wa-guest': 'guestWaDone',
      'wa-internal': 'internalWaDone',
      knowledge: 'kbDone',
      users: 'usersDone',
      ai: 'aiDone',
    };
    const stateField = stepFieldMap[stepKey];
    if (stateField) {
      prisma.onboardingState.upsert({
        where: { hotelId },
        update: { [stateField]: true },
        create: { hotelId, [stateField]: true },
      }).catch(() => {});
    }

    const updateData = {
      onboardingSteps: JSON.stringify(stepsDone),
    };

    if (stepKey === 'wa-guest' && (data?.phone || data?.displayPhoneNumber)) {
      updateData.whatsappNumber = data.phone || data.displayPhoneNumber;
    }

    if (hotel) {
      await prisma.hotel.update({
        where: { id: hotel.id },
        data: updateData,
      }).catch(() => {});
    }

    // Ensure WhatsAppIntegration table columns are ready
    if (stepKey === 'wa-guest' || stepKey === 'wa-internal') {
      await ensureWhatsAppColumns();
      const targetType = stepKey === 'wa-guest' ? 'guest' : 'internal';
      const rawPhone = data?.phone || data?.displayPhoneNumber || (targetType === 'guest' ? hotel?.whatsappNumber : hotel?.phone) || '';
      const cleanPhone = String(rawPhone).replace(/\D/g, '');
      const phoneNumberId = data?.phoneNumberId || `phone_${cleanPhone || Date.now()}`;
      const wabaId = data?.wabaId || `waba_${hotelId}_${targetType}`;
      const accessToken = data?.accessToken || null;

      if (cleanPhone || phoneNumberId) {
        try {
          await prisma.whatsAppIntegration.upsert({
            where: {
              hotelId_targetType: {
                hotelId,
                targetType,
              },
            },
            update: {
              phoneNumber: cleanPhone,
              displayPhoneNumber: rawPhone,
              phoneNumberId,
              wabaId,
              ...(accessToken ? { accessToken } : {}),
              status: 'connected',
              lastError: null,
            },
            create: {
              hotelId,
              targetType,
              phoneNumber: cleanPhone,
              displayPhoneNumber: rawPhone,
              phoneNumberId,
              wabaId,
              accessToken,
              status: 'connected',
            },
          });
        } catch (waErr) {
          console.warn('[Onboarding WhatsAppIntegration Upsert Warning]:', waErr.message);
        }
      }
    }

    // Log activity if an email mailbox is connected
    if (stepKey === 'email') {
      try {
        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId,
            at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            kind: 'room',
            text: `Guest mailbox connected: ${data?.address || hotel?.email || 'reception'}`,
            meta: 'Setup Wizard',
          },
        });
      } catch {}
    }

    // Log activity if guest WhatsApp is connected
    if (stepKey === 'wa-guest') {
      try {
        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId,
            at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            kind: 'room',
            text: `Guest WhatsApp connected: ${data?.phone || hotel?.whatsappNumber || ''}`,
            meta: 'Setup Wizard',
          },
        });
      } catch {}
    }

    // Log activity if internal staff WhatsApp is connected
    if (stepKey === 'wa-internal') {
      try {
        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId,
            at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            kind: 'room',
            text: `Internal Staff WhatsApp connected: ${data?.phone || hotel?.phone || ''}`,
            meta: 'Setup Wizard',
          },
        });
      } catch {}
    }

    // Handle Step 8: AI Rules & Mode Persistence
    if (stepKey === 'ai' && data) {
      try {
        if (data.aiMode) {
          await prisma.hotel.update({
            where: { id: hotel?.id || hotelId },
            data: { aiMode: data.aiMode },
          }).catch(() => {});
        }
        if (Array.isArray(data.rules)) {
          for (const r of data.rules) {
            if (!r.topic || !r.mode) continue;
            await prisma.aiRule.upsert({
              where: {
                hotelId_topic: {
                  hotelId: hotel?.id || hotelId,
                  topic: r.topic,
                },
              },
              update: {
                mode: r.mode,
                note: r.note || '',
              },
              create: {
                hotelId: hotel?.id || hotelId,
                topic: r.topic,
                mode: r.mode,
                note: r.note || '',
              },
            }).catch(() => {});
          }
        }
      } catch (aiErr) {
        console.warn('[Onboarding AI Step Warning]:', aiErr.message);
      }
    }

    return successResponse(res, {
      stepKey,
      onboardingSteps: stepsDone,
      email: data?.email || data?.address,
      phone: data?.phone,
      role: data?.role,
    }, `Step ${stepKey} saved successfully`);
  } catch (error) {
    next(error);
  }
};

export const completeOnboarding = async (req, res, next) => {
  try {
    await ensureHotelColumns();
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) return errorResponse(res, 'Hotel entity not found', 404);

    if (hotel) {
      await prisma.hotel.update({
        where: { id: hotel.id },
        data: { onboardingDone: true },
      });

      await prisma.onboardingState.upsert({
        where: { hotelId: hotel.id },
        update: {
          pmsDone: true,
          emailDone: true,
          guestWaDone: true,
          internalWaDone: true,
          kbDone: true,
          usersDone: true,
          aiDone: true,
          currentStep: 8,
        },
        create: {
          hotelId: hotel.id,
          pmsDone: true,
          emailDone: true,
          guestWaDone: true,
          internalWaDone: true,
          kbDone: true,
          usersDone: true,
          aiDone: true,
          currentStep: 8,
        },
      }).catch(() => {});
    }

    try {
      await prisma.activityItem.create({
        data: {
          id: `act-${Date.now()}`,
          hotelId,
          at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          kind: 'room',
          text: `${hotel?.name || 'Hotel'} onboarding completed and live!`,
          meta: 'Setup Wizard',
        },
      });
    } catch {}

    return successResponse(res, { complete: true }, 'Onboarding completed');
  } catch (error) {
    next(error);
  }
};

export const handleEmailDetect = async (req, res, next) => {
  try {
    const input = req.query.email || req.query.domain || '';
    const { detectEmailProvider } = await import('../../utils/emailDetect.js');
    const result = await detectEmailProvider(input);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

