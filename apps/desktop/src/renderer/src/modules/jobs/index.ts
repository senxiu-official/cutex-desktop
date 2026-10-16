// 作业 (cutex Job Service, Linux hosts): the status category (step 2), the 作业 page and its sidebar
// entry (step 3). The entry is hidden, not greyed, where the host has no Job Service (§13.2).
// NCI remote jobs on the 作业 page (source / PBS id / stale hint / 手动标记 / 复制 PBS 作业号) render
// only while module `nci` (NCI 远程作业, default off) is on; its settings guide lives in modules/nci.
import { Hourglass } from "lucide-react";
import { JOB_SERVICE_FEATURE } from "../../lib/jobs";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { JobsPage } from "./JobsPage";
import { JobsBody, JobsMeta, JobsStatusBar } from "./JobStatus";
import { useJobsStatus } from "./useJobsStatus";

export default defineModule({
  id: "jobs",
  titleKey: "jobs.title",
  descriptionKey: "jobs.description",
  // The Job Service is an optional cutex component (components spec v2): the 作业 page shows the
  // component card (install / update cutex / …) while the host's job-service is not ready.
  requires: { capabilities: [JOB_SERVICE_FEATURE], component: "job-service" },
  contributes: {
    "conversation.status": [
      { id: "jobs.status", order: 600, titleKey: "jobs.statusTitle", defaultPlace: "capsule", useStatus: useJobsStatus, Meta: JobsMeta, Body: JobsBody, Bar: JobsStatusBar, icon: Hourglass },
    ],
    "nav.primary": [{ id: "jobs.nav", order: 600, icon: Hourglass, titleKey: "jobs.nav", unavailable: "hide", target: { page: "jobs.page" } }],
    "main.page": [{ id: "jobs.page", Page: JobsPage, useTitle: pageTitle("jobs.nav") }],
  },
});
