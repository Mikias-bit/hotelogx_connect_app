import { upsellPipeline, hotelDate, postedTotals } from '../upsells/upsellReporting.js';
import { readOperations } from '../reports/reportOperations.js';
import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';

export const DEFAULT_AI_RULES = [
  { topic: 'General questions', mode: 'Autonomous', note: 'Wi-Fi, directions, opening hours' },
  { topic: 'Hotel information', mode: 'Autonomous', note: 'Answered from the knowledge base' },
  { topic: 'Availability & pricing', mode: 'Autonomous', note: 'Reads Mews, never books' },
  { topic: 'Upsells', mode: 'Autonomous', note: 'Only offers from the priced catalogue' },
  { topic: 'Housekeeping requests', mode: 'Autonomous', note: 'Creates tasks and confirms to the guest' },
  { topic: 'Maintenance reports', mode: 'Autonomous', note: 'Opens a ticket, notifies the technician' },
  { topic: 'Late checkout / early check-in', mode: 'Human Approval', note: 'Depends on occupancy' },
  { topic: 'Complaints', mode: 'Human Approval', note: 'AI drafts, a human sends' },
  { topic: 'Refunds', mode: 'Always Escalate', note: 'Never handled by AI' },
  { topic: 'Billing disputes', mode: 'Always Escalate', note: 'Folio pulled and attached' },
  { topic: 'Safety issues', mode: 'Always Escalate', note: 'Duty manager notified immediately' },
  { topic: 'VIP guests', mode: 'Human Approval', note: 'AI prepares, staff confirms' },
];

const VALID_GLOBAL_MODES = ['Autonomous', 'Approval Required', 'Suggestions Only'];
const MODE_MAP = {
  Auto: 'Autonomous',
  Autonomous: 'Autonomous',
  Approve: 'Human Approval',
  'Human Approval': 'Human Approval',
  Escalate: 'Always Escalate',
  'Always Escalate': 'Always Escalate',
};

export const getBriefing = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Unauthorized', 401);

    const [
      hotel,
      rooms,
      openTasks,
      openIssues,
      conversations,
      upsells,
      activities,
    ] = await Promise.all([
      prisma.hotel.findUnique({ where: { id: hotelId } }).catch(() => null),
      prisma.room.findMany({ where: { hotelId } }),
      prisma.task.count({ where: { hotelId, status: { not: 'Completed' } } }),
      prisma.issue.count({ where: { hotelId, status: { not: 'Completed' } } }),
      prisma.conversation.findMany({
        where: { guest: { hotelId } },
        include: { guest: true },
      }),
      upsellPipeline(prisma, hotelId),
      prisma.activityItem.findMany({ where: { hotelId }, take: 10, orderBy: { id: 'desc' } }),
    ]);

    const daily = await readOperations(prisma, req.user);
    const totalRooms = rooms.length || 0;
    const occupiedRooms = rooms.filter((r) => r.guestStatus !== 'Vacant').length;
    const cleanRooms = rooms.filter((r) => r.status === 'Clean' || r.status === 'Inspected').length;
    const dirtyRooms = rooms.filter((r) => r.status === 'Dirty').length;
    const vipSource = daily.sources.find(s => s.kind === 'vip');
    const vipArrivals = vipSource?.status === 'complete' && !vipSource.stale ? daily.vips.length : 0;

    const escalations = conversations
      .filter((c) => c.escalation)
      .map((c) => {
        let parsedEscalation = null;
        try {
          parsedEscalation = typeof c.escalation === 'string' ? JSON.parse(c.escalation) : c.escalation;
        } catch (_) {
          parsedEscalation = { reason: String(c.escalation) };
        }
        return {
          id: c.id,
          guestName: c.guest?.name || c.guestId,
          room: c.guest?.room || undefined,
          escalation: parsedEscalation,
        };
      });

    const postedUpsellsTotal = upsells
      .filter((u) => u.postingStatus === 'posted')
      .reduce((acc, curr) => acc + curr.value, 0);

    const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    const aiAdvice = daily.briefing.map(text => ({ topic: 'Daily operations', level: 'ai', title: text, action: 'Review the corresponding operational tasks.' }));
    if (daily.housekeeping.unassigned) aiAdvice.push({ topic: 'Housekeeping', level: 'attend', title: `${daily.housekeeping.unassigned} tasks need assignment`, action: 'Select tasks and an available housekeeper.' });
    if (daily.housekeeping.problems) aiAdvice.push({ topic: 'Housekeeping', level: 'urgent', title: `${daily.housekeeping.problems} reported problems`, action: 'Review DND and maintenance notes before reassigning work.' });
    if (openIssues) aiAdvice.push({ topic: 'Maintenance', level: 'attend', title: `${openIssues} open maintenance issues`, action: 'Review current maintenance tickets.' });

    const briefing = {
      hotelName: hotel?.name || 'Hotel',
      occupancy: {
        total: totalRooms,
        occupied: occupiedRooms,
        rate: occupancyPct,
        clean: cleanRooms,
        dirty: dirtyRooms,
        vipArrivals,
      },
      operations: {
        openTasks: openTasks + daily.tasks.filter(t => t.status !== 'Completed').length,
        openIssues,
        pendingEscalations: escalations.length,
      },
      upsellRevenue: postedUpsellsTotal,
      upsellPostedTotals: postedTotals(upsells),
      escalations,
      aiAdvice,
      dailyOperations: daily,
      recentActivity: activities,
    };

    return successResponse(res, briefing, 'Manager briefing aggregated');
  } catch (error) {
    next(error);
  }
};

export const getActivityFeed = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Unauthorized', 401);
    const activities = await prisma.activityItem.findMany({
      where: { hotelId },
      take: 20,
      orderBy: { id: 'desc' },
    });
    return successResponse(res, activities, 'Activity feed');
  } catch (error) {
    next(error);
  }
};

export const getAiRules = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Unauthorized', 401);

    // Fetch hotel global aiMode
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { aiMode: true },
    }).catch(() => null);

    let rules = await prisma.aiRule.findMany({
      where: { hotelId },
      orderBy: { id: 'asc' },
    });

    // Seed default rules for this hotel if empty
    if (!rules || rules.length === 0) {
      for (const def of DEFAULT_AI_RULES) {
        await prisma.aiRule.upsert({
          where: {
            hotelId_topic: {
              hotelId,
              topic: def.topic,
            },
          },
          update: {},
          create: {
            hotelId,
            topic: def.topic,
            mode: def.mode,
            note: def.note,
          },
        }).catch(() => {});
      }

      rules = await prisma.aiRule.findMany({
        where: { hotelId },
        orderBy: { id: 'asc' },
      });
    }

    return successResponse(
      res,
      {
        aiMode: hotel?.aiMode || 'Autonomous',
        rules,
      },
      'AI Rules'
    );
  } catch (error) {
    next(error);
  }
};

export const updateAiRules = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Authentication required: missing hotel identifier', 401);
    }

    const { aiMode, rules } = req.body;

    // Validate and update global aiMode if provided
    if (aiMode !== undefined) {
      if (!VALID_GLOBAL_MODES.includes(aiMode)) {
        return errorResponse(res, `Invalid aiMode. Must be one of: ${VALID_GLOBAL_MODES.join(', ')}`, 400);
      }
      await prisma.hotel.update({
        where: { id: hotelId },
        data: { aiMode },
      }).catch(() => {});
    }

    // Validate and upsert topic rules if provided
    if (rules && Array.isArray(rules)) {
      for (const r of rules) {
        if (!r.topic) continue;
        const normalizedMode = MODE_MAP[r.mode];
        if (!normalizedMode) {
          return errorResponse(
            res,
            `Invalid mode '${r.mode}' for topic '${r.topic}'. Allowed: Autonomous, Human Approval, Always Escalate (or Auto, Approve, Escalate)`,
            400
          );
        }

        await prisma.aiRule.upsert({
          where: {
            hotelId_topic: {
              hotelId,
              topic: r.topic,
            },
          },
          update: {
            mode: normalizedMode,
            note: r.note !== undefined ? r.note : undefined,
          },
          create: {
            hotelId,
            topic: r.topic,
            mode: normalizedMode,
            note: r.note || '',
          },
        });
      }
    }

    // Return updated state for this hotel
    const [updatedHotel, updatedRules] = await Promise.all([
      prisma.hotel.findUnique({ where: { id: hotelId }, select: { aiMode: true } }).catch(() => null),
      prisma.aiRule.findMany({ where: { hotelId }, orderBy: { id: 'asc' } }),
    ]);

    return successResponse(
      res,
      {
        aiMode: updatedHotel?.aiMode || aiMode || 'Autonomous',
        rules: updatedRules,
      },
      'AI Rules updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

export const getKnowledgeDocs = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Unauthorized', 401);
    const docs = await prisma.knowledgeDoc.findMany({
      where: { hotelId },
      orderBy: { updatedAt: 'desc' },
    });
    return successResponse(res, docs, 'Knowledge documents');
  } catch (error) {
    next(error);
  }
};

/**
 * Endpoint: GET /api/manager/trends
 * Computes rolling 7-day historical trends for conversations, AI resolution rate, and upsells
 */
export const getDashboardTrends = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Unauthorized: hotel context required', 401);

    const now = new Date();
    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } });
    const timezone = hotel?.timezone || 'UTC';
    const today = hotelDate(now, timezone);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) + (i - 6) * 86400000);
      return { dateStr: date.toISOString().slice(0, 10), dayName: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(date) };
    });
    const weekdays = days.map(d => d.dayName);
    // A broad UTC lower bound includes the first local day for all hotel timezones.
    const sevenDaysAgo = new Date(Date.parse(`${days[0].dateStr}T00:00:00Z`) - 86400000);

    const [conversations, upsells] = await Promise.all([
      prisma.conversation.findMany({
        where: {
          guest: { hotelId },
          createdAt: { gte: sevenDaysAgo },
        },
        select: {
          id: true,
          aiStatus: true,
          aiHandledCount: true,
          createdAt: true,
        },
      }),
      upsellPipeline(prisma, hotelId).then(rows => rows.filter(row => row.postingStatus === 'posted')),
    ]);

    const conversationTrend = [];
    const aiTrend = [];
    const upsellTrend = [];
    const currencies = [...new Set(upsells.map(u => u.currency))];
    let hasData = false;

    for (const day of days) {
      const dayConvs = conversations.filter((c) => {
        return hotelDate(c.createdAt, timezone) === day.dateStr && new Date(c.createdAt) <= now;
      });

      const convCount = dayConvs.length;
      conversationTrend.push(convCount);
      if (convCount > 0) hasData = true;

      if (convCount > 0) {
        const aiHandled = dayConvs.filter(
          (c) =>
            (c.aiHandledCount && c.aiHandledCount > 0) ||
            ['ai-handling', 'resolved', 'Done', 'Autonomous'].includes(c.aiStatus)
        ).length;
        aiTrend.push(Math.round((aiHandled / convCount) * 100));
      } else {
        aiTrend.push(0);
      }

      const dayUpsells = upsells.filter((u) => {
        if (!u.postedAt) return false;
        return hotelDate(u.postedAt, timezone) === day.dateStr && new Date(u.postedAt) <= now;
      });
      const dayUpsellTotal = currencies.length <= 1 ? dayUpsells.reduce((acc, curr) => acc + Math.round(Number(curr.value) * 100), 0) / 100 : 0;
      upsellTrend.push(dayUpsellTotal);
      if (dayUpsellTotal > 0) hasData = true;
    }

    return successResponse(
      res,
      {
        weekdays,
        conversationTrend,
        aiTrend,
        upsellTrend,
        upsellTrendCurrency: currencies.length === 1 ? currencies[0] : null,
        upsellTrendMixedCurrencies: currencies.length > 1,
        timezone,
        hasData,
      },
      'Dashboard 7-day rolling trends computed'
    );
  } catch (error) {
    next(error);
  }
};
