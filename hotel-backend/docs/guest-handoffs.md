# Front Office handoff and guest outcome

Department completion and guest resolution are separate records. A technician marking a repair Completed does not confirm that the guest's problem has gone away, that Front Office has read the report, or that anyone has contacted the guest.

## Daily workflow

1. Guest messages that create housekeeping or maintenance tasks automatically open a linked guest follow-up. For phone/in-person problems, select **Guest-reported problem: require Front Office follow-up** when creating a task. Existing work can be marked using **Guest-reported problem → Track guest follow-up** in the task list or maintenance work view.
2. The department completes its own work using its existing dashboard or WhatsApp buttons. The work remains Completed while its guest outcome remains open. The handoff is recorded in Neon and the task/issue history; linked conversations receive an internal audit note and enter the existing escalation queue.
3. In **Tasks → Guest follow-ups**, or the existing conversation sidebar, Front Office selects **Acknowledge Front Office handoff**. This records who received the department report and when. System notification/visibility alone does not count as acknowledgment.
4. Front Office uses the conversation composer, telephone or an in-person visit to contact the guest. Then select **Record guest contacted** with the channel and outcome. These forms record contact that actually happened; they do not send a message. **Record contact attempt** means no response and leaves the issue open. **Contact not required** needs a reason, such as an explicit guest request not to be disturbed.
5. **Confirm issue resolved** requires department completion, Front Office acknowledgment, and successful contact or a justified contact exception. Record what confirms resolution. An unanswered attempt cannot resolve the issue.
6. If the problem continues, use **Guest says problem continues / reopen**. The same work item returns to the department for reassignment. It does not silently assign an off-shift worker. A new work cycle resets current acknowledgment/contact fields while preserving all earlier completion, assignment and contact details in audit history.

## Where staff see it

- Existing Front Office/manager task pages: a collapsible **Guest follow-ups** list with its open count; individual task rows also expose their handoff.
- Existing conversation sidebar: all linked follow-ups, including resolved history.
- Existing **Escalated** view: linked conversations plus a collapsible list for guest issues without a conversation.
- Existing dashboard escalation tiles: existing conversation counts plus outstanding Front Office handoffs without a linked conversation. The tiles open the existing escalation view. No new dashboard panels are added.
- Department work views: staff can read the handoff and its outcome. Only Front Office and managers may acknowledge contact, resolve or reopen the guest issue.

Open follow-ups remain visible across shifts and dates. A department task can be Completed while its guest follow-up stays open. Closing a conversation or returning it to AI is blocked until all its guest follow-ups are resolved. Taking over or replying to a conversation does not remove an outstanding handoff from escalation counts.

## AI behavior

Guest replies during a completed-work handoff or reopened cycle go to Front Office for review without creating a duplicate task or claiming the problem is solved. Explicit English recurrence phrases such as “still leaking”, “not fixed” or “same problem” after a resolved follow-up are also routed for review. This is a conservative phrase check, not universal multilingual understanding. Staff select the appropriate original work to reopen; the AI does not guess which of several repairs failed or infer resolution from “thank you”.

Task completion no longer fabricates a guest-facing success message in the browser. Department completion, provider submission, Front Office acknowledgment and guest outcome are distinct facts. Use existing messaging to send actual guest replies, and record their outcome explicitly.

## Storage and safeguards

`GuestHandoff` is unique per hotel, work kind and work ID; optional conversation links are validated against the same hotel. `GuestHandoffEvent` stores actor, timestamp, cycle, action, note and prior state when reopened. Task/issue histories and linked conversations also receive internal audit entries.

Completion and handoff updates share the task's database transaction and hotel lock. Version checks reject stale edits and simultaneous resolutions. Reopened work revokes previous assignment buttons and invalidates room inspection/release approvals. Existing operational blockers still apply. Unresolved guest housekeeping work cannot be cancelled to hide it.

Migration `20261030050000_guest_handoffs` creates the records and backfills existing conversation-linked housekeeping/maintenance tasks. Completed legacy work enters Front Office review; no contact, acknowledgment or guest resolution is invented. Unknown completion times stay unknown. Legacy issues without a reliable guest/conversation link must be explicitly marked by staff.

## Deployment and validation

Apply the migration and deploy the backend before deploying the frontend. From `hotel-backend`:

```powershell
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
gcloud.cmd builds submit . --config=cloudbuild.yaml --project=hotelogx
if ($LASTEXITCODE -ne 0) { throw 'Backend deployment failed' }
```

Push the frontend changes to the GitHub branch connected to Netlify afterward. No Python engine, MCP server, Meta template or new Scheduler job is required.

```powershell
npm.cmd run test:handoffs
npm.cmd run test:handoffs:database
node scripts/test-maintenance-database.mjs .env
npm.cmd run test:operations:database
```

Database tests use disposable schemas and mocked WhatsApp sends. They cover separate stages, failed contact, reopening, old buttons, tenant isolation, concurrent edits, HTTP permissions, conversation-close/takeover guards and AI routing. They do not send real guest messages or migrate the application's public schema.
