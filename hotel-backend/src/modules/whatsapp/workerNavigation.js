export const workerNavigationIds = {
  housekeeping: 'ops.view.housekeeping',
  maintenance: 'ops.view.maintenance',
};

// Navigation only opens current work. Acceptance and execution still require signed actions.
export function createWorkerOperationsHandler({ db, housekeeping, maintenance }) {
  return async (integration, message) => {
    if (!['internal', 'both'].includes(integration.targetType)) return false;
    const payload = message.interactive?.button_reply?.id || message.button?.payload;
    let department = Object.keys(workerNavigationIds).find(key => workerNavigationIds[key] === payload);
    const legacyView = message.type === 'button' && !/^(hk|mt)\./.test(payload || '') &&
      /^view\s+tasks$/i.test((message.button?.text || message.button?.payload || '').trim());
    if (!department && legacyView && message.context?.id) {
      const where = { hotelId: integration.hotelId, messageId: message.context.id };
      const [hk, mt] = await Promise.all([
        db.housekeepingAssignment.findFirst({ where }), db.maintenanceAssignment.findFirst({ where }),
      ]);
      if (Boolean(hk) !== Boolean(mt)) department = hk ? 'housekeeping' : 'maintenance';
    }
    if (department || legacyView) {
      const navigation = { ...message, type: 'text', button: undefined, interactive: undefined,
        text: { body: department === 'housekeeping' ? 'HOUSEKEEPING' : department === 'maintenance' ? 'MAINTENANCE' : 'TASKS' },
        workerNavigation: true };
      // Each service verifies the active worker in this hotel using the sender's phone.
      if (department) return (department === 'housekeeping' ? housekeeping : maintenance).handle(integration, navigation);
      return await maintenance.handle(integration, navigation) || housekeeping.handle(integration, navigation);
    }
    return await maintenance.handle(integration, message) || housekeeping.handle(integration, message);
  };
}

export async function assignmentTemplate({ request, integration, token, template, department }) {
  if (!workerNavigationIds[department]) throw new Error('Invalid assignment department');
  // Inspect the approved template so existing text-only templates continue to work.
  const result = await request(`${integration.wabaId}/message_templates`, token, {
    query: { name: template.name, fields: 'name,language,status,components', limit: '100' },
  });
  const approved = result.data?.find(row => row.name === template.name && row.language === template.language.code && row.status === 'APPROVED');
  if (!approved) throw new Error('Assignment template must be approved in the configured language');
  const buttons = approved.components?.find(component => component.type === 'BUTTONS')?.buttons || [];
  const index = buttons.findIndex(button => button.type === 'QUICK_REPLY' && /^view\s+tasks$/i.test(button.text?.trim() || ''));
  if (!buttons.length) return template;
  if (index < 0) throw new Error('Assignment template needs a Quick reply button labelled View Tasks');
  return { ...template, components: [...(template.components || []), {
    type: 'button', sub_type: 'quick_reply', index: String(index),
    parameters: [{ type: 'payload', payload: workerNavigationIds[department] }],
  }] };
}
