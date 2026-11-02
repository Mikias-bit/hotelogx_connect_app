# Assignment notification buttons

In Meta WhatsApp Manager, add a **Quick reply** button labelled **View Tasks** to the assignment template and wait for approval. A website/URL button does not send a reply to this webhook.

The body still uses two positional variables: `{{1}}` = worker name, `{{2}}` = task count. Suggested shared wording:

> Hi {{1}}, you have been assigned {{2}} tasks. Tap View Tasks to view your assignments.

Configure the approved template name and language in each department's existing WhatsApp settings. Housekeeping and maintenance may use the same template in the same WhatsApp Business Account if its wording applies to both. A template saying “housekeeping tasks” should not be used for maintenance. Templates belong to their WABA; another hotel's WABA needs its own approved template.

The sender reads the configured template from Meta (requires `whatsapp_business_management`) and attaches a department-specific payload to the View Tasks quick reply. Existing templates with no buttons still support the typed TASKS/MAINTENANCE path. Lookup/approval errors stop the send rather than guess the button structure. No uncertain message is automatically resent.

View Tasks opens the registered worker's current assignments; it does not accept them. Acceptance, start and completion retain their signed buttons, worker/hotel checks and webhook deduplication. Replies to older View Tasks notifications use their original message ID to identify the department where possible. If the worker belongs to both departments and the department is unknown, department-selection buttons are shown.

Deploy the backend for this change; there is no database migration or frontend build required. This change supports the English View Tasks label; worker-language translations remain separate work.

Live check after deployment: assign a task outside the messaging window, tap View Tasks, confirm the correct room/task and Accept button, then exercise Accept, Start and Completed while checking dashboard status. Repeat for maintenance and a worker registered in both departments. Verify that merely viewing does not accept a task.
