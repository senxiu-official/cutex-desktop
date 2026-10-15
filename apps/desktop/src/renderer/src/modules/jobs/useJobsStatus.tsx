// useStatus of the 作业 category: present while a job runs or one ended < 30 min ago. Polled while
// the category is placed in the capsule (this hook runs only there).
import { Hourglass } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { jobsWorthShowing, type AgentJobs } from "../../lib/jobs";
import { useAgentJobs } from "../../lib/jobsView";
import type { StatusLine } from "../slots";
import { JobLine } from "./JobStatus";

export function useJobsStatus(sessionId: string): { data: AgentJobs; line: StatusLine } | null {
  const data = useAgentJobs(sessionId, true);
  if (!jobsWorthShowing(data, Math.floor(Date.now() / 1000))) return null;
  return {
    data,
    line: {
      icon: <Hourglass size={14} className={`shrink-0 ${data.open.length > 0 ? "text-accent" : "text-subtle"}`} />,
      text: <JobLine data={data} />,
      title: [...data.open, ...data.finished.slice(0, 3)].map((j) => j.command || j.actionId || j.jobId).join("\n"),
      trailing: <StatusMore n={data.open.length} />,
    },
  };
}
