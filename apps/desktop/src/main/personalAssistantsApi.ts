// 个人助理 (cutex r295 personal-assistants-local-v1; r296 recurring / owner views) through the pinned CutexClient: fixed
// routes only, request bodies rebuilt from checked fields (shared/personalAssistants), replies checked before the
// renderer sees them. Reads are background priority; writes are the owner's explicit actions (create / settings /
// grants / enable / confirm / cancel / 定期任务 confirm, pause, cancel / calendar import, clear).
import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { DaemonApi } from "../shared/ipc";
import {
  PA_PATH, paAgendaQuery, paCalendarBody, paCalendarClearBody, paCancelBody, paConfirmBody, paCreateBody, paId, paListQuery, paNotesQuery,
  paOwnerRequestsQuery, paRequestsQuery, paRunsQuery, paSeqQuery, paTemplateBody, paTemplateStopBody, paTemplatesQuery, paUpdateBody,
  readPaCreateOptions, readPaAgenda, readPaAudit, readPaCalendar, readPaList, readPaNotes, readPaRequestDetail, readPaRequestPage, readPaRequestReply, readPaRuns,
  readPaTemplateReply, readPaTemplates, readPaView,
} from "../shared/personalAssistants";

import { paScopeRulesBody, readPaScopeRules, paBriefScheduleBody, readPaBrief, paReminderCreateBody, readPaReminder, ownerPinCreateBody, readCreatedOwnerPin } from "../shared/personalAssistantsPhase1";

const one = (id: string) => `${PA_PATH}/${encodeURIComponent(paId(id))}`;
const request = (id: string, requestId: string) => `${one(id)}/requests/${encodeURIComponent(paId(requestId))}`;
const template = (id: string, key: string) => `${one(id)}/templates/${encodeURIComponent(paId(key))}`;

export type PersonalAssistantsMethods =
  | "paScopeRules" | "paScopeRulesSave" | "paBrief" | "paBriefSchedule" | "paReminderCreate" | "ownerPinCreate"
  | "paCreateOptions" | "paList" | "paGet" | "paCreate" | "paUpdate" | "paAgenda" | "paAudit" | "paRequests" | "paRequest" | "paConfirm" | "paCancel"
  | "paOwnerRequests" | "paNotes" | "paTemplates" | "paTemplateConfirm" | "paTemplateStop" | "paTemplateRuns" | "paCalendar" | "paCalendarImport" | "paCalendarClear";

export function personalAssistantsApi(client: CutexClient): Pick<DaemonApi, PersonalAssistantsMethods> {
  return {
    async paScopeRules(id) { return readPaScopeRules(await client.request("GET", `${one(id)}/scope-rules`, { background: true })); },
    async paScopeRulesSave(id, body) { return readPaScopeRules(await client.request("PUT", `${one(id)}/scope-rules`, { body: paScopeRulesBody(body) })); },
    async paBrief(id) { return readPaBrief(await client.request("GET", `${one(id)}/brief`, { background: true })); },
    async paBriefSchedule(id, body) { return readPaBrief(await client.request("PUT", `${one(id)}/brief`, { body: paBriefScheduleBody(body) })); },
    async paReminderCreate(id, body) { return readPaReminder(await client.request("POST", `${one(id)}/reminders`, { body: paReminderCreateBody(body) })); },
    async ownerPinCreate(body) { return readCreatedOwnerPin(await client.request("POST", "/v2/owner-pins", { body: ownerPinCreateBody(body) })); },
    async paCreateOptions() {
      return readPaCreateOptions(await client.request("GET", `${PA_PATH}/create-options`, { background: true }));
    },
    async paList(q) {
      return readPaList(await client.request("GET", PA_PATH, { query: paListQuery(q), background: true }));
    },
    async paGet(id) {
      return readPaView(await client.request("GET", one(id), { background: true }));
    },
    async paCreate(input) {
      return readPaView(await client.request("POST", PA_PATH, { body: paCreateBody(input) }));
    },
    async paUpdate(id, input) {
      return readPaView(await client.request("PATCH", one(id), { body: paUpdateBody(input) }));
    },
    async paAgenda(id, q) {
      return readPaAgenda(await client.request("GET", `${one(id)}/agenda`, { query: paAgendaQuery(q), background: true }));
    },
    async paAudit(id, q) {
      return readPaAudit(await client.request("GET", `${one(id)}/audit`, { query: paSeqQuery(q), background: true }));
    },
    async paRequests(id, q) {
      return readPaRequestPage(await client.request("GET", `${one(id)}/requests`, { query: paRequestsQuery(q), background: true }));
    },
    async paRequest(id, requestId) {
      return readPaRequestDetail(await client.request("GET", request(id, requestId), { background: true }));
    },
    async paConfirm(id, requestId, input) {
      return readPaRequestReply(await client.request("POST", `${request(id, requestId)}/confirm`, { body: paConfirmBody(input) }));
    },
    async paCancel(id, requestId, input) {
      return readPaRequestReply(await client.request("POST", `${request(id, requestId)}/cancel`, { body: paCancelBody(input) }));
    },
    async paOwnerRequests(q) {
      return readPaRequestPage(await client.request("GET", `${PA_PATH}/requests`, { query: paOwnerRequestsQuery(q), background: true }));
    },
    async paNotes(id, q) {
      return readPaNotes(await client.request("GET", `${one(id)}/notes`, { query: paNotesQuery(q), background: true }));
    },
    async paTemplates(id, q) {
      return readPaTemplates(await client.request("GET", `${one(id)}/templates`, { query: paTemplatesQuery(q), background: true }));
    },
    async paTemplateConfirm(id, key, input) {
      // A new template is POSTed; re-confirming (resume / change / after the assistant or Director changed) is a PUT.
      return key === null
        ? readPaTemplateReply(await client.request("POST", `${one(id)}/templates`, { body: paTemplateBody(input, false) }))
        : readPaTemplateReply(await client.request("PUT", template(id, key), { body: paTemplateBody(input, true) }));
    },
    async paTemplateStop(id, key, how, input) {
      if (how !== "pause" && how !== "cancel") throw new Error("invalid template action");
      return readPaTemplateReply(await client.request("POST", `${template(id, key)}/${how}`, { body: paTemplateStopBody(input) }));
    },
    async paTemplateRuns(id, key, q) {
      return readPaRuns(await client.request("GET", `${template(id, key)}/runs`, { query: paRunsQuery(q), background: true }));
    },
    async paCalendar(id) {
      return readPaCalendar(await client.request("GET", `${one(id)}/calendar`, { background: true }));
    },
    async paCalendarImport(id, input) {
      return readPaCalendar(await client.request("PUT", `${one(id)}/calendar`, { body: paCalendarBody(input) }));
    },
    async paCalendarClear(id, input) {
      return readPaCalendar(await client.request("DELETE", `${one(id)}/calendar`, { body: paCalendarClearBody(input) }));
    },
  };
}
