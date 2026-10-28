import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const fields = {
  category: ['Item category', 80], item: ['Item', 200], description: ['Description', 4000],
  foundLocation: ['Location found', 200], storageLocation: ['Place of storage', 200],
};
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function itemData(body) {
  const data = {};
  for (const [field, [label, limit]] of Object.entries(fields)) {
    const value = body?.[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
      fail(`${label} is required and must be no more than ${limit} characters.`);
    }
    data[field] = value.trim();
  }
  return data;
}

export function createLostFoundRouter({ db = prisma, auth = authenticate } = {}) {
  const router = Router();
  router.use(auth, (req, res, next) => req.user?.hotelId && ['manager', 'front-office'].includes(req.user.role)
    ? next() : errorResponse(res, 'Manager or Front Office access required', 403));
  const run = (fn, status = 200) => async (req, res) => {
    try { return successResponse(res, await fn(req), 'Success', status); }
    catch (error) { return errorResponse(res, error.status ? error.message : 'Lost & Found is temporarily unavailable. Please try again.', error.status || 503); }
  };
  router.get('/', run(async req => {
    const q = req.query.q ?? '', pageValue = req.query.page ?? '1';
    if (typeof q !== 'string' || q.length > 200 || typeof pageValue !== 'string' || !/^[1-9]\d{0,5}$/.test(pageValue)) fail('Enter a valid search and page number.');
    const page = Number(pageValue), pageSize = 50;
    const where = { hotelId: req.user.hotelId, ...(q.trim() ? {
      OR: Object.keys(fields).map(field => ({ [field]: { contains: q.trim(), mode: 'insensitive' } })),
    } : {}) };
    const [items, total] = await Promise.all([
      db.lostFoundItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      db.lostFoundItem.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }));
  router.post('/', run(req => db.lostFoundItem.create({ data: {
    ...itemData(req.body), hotelId: req.user.hotelId, createdBy: req.user.id, updatedBy: req.user.id,
  } }), 201));
  router.patch('/:id', run(async req => {
    const data = itemData(req.body);
    if (!Number.isInteger(req.body.version) || req.body.version < 1 || req.body.version > 2147483646) fail('Refresh the item before saving.');
    const where = { id: req.params.id, hotelId: req.user.hotelId };
    const result = await db.lostFoundItem.updateMany({
      where: { ...where, version: req.body.version },
      data: { ...data, updatedBy: req.user.id, version: { increment: 1 } },
    });
    const item = await db.lostFoundItem.findFirst({ where });
    if (!item) fail('Item not found.', 404);
    if (result.count !== 1) fail('Someone updated this item. Close the form, refresh the list and reopen it before saving.', 409);
    return item;
  }));
  return router;
}

export default createLostFoundRouter();
