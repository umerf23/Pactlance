import type { PapProtocol, WorkType } from "./schema";
export const templates: {
  id: WorkType;
  title: string;
  deliverable: string;
  criteria: string[];
  evidence: PapProtocol["milestones"][number]["deliverables"][number]["requiredEvidenceTypes"];
}[] = [
  {
    id: "website",
    title: "Website development",
    deliverable: "Responsive website",
    criteria: [
      "All agreed pages load at the supplied preview URL.",
      "Layouts work at the agreed mobile and desktop viewport sizes.",
    ],
    evidence: ["link", "application/zip"],
  },
  {
    id: "ui_ux",
    title: "UI/UX design",
    deliverable: "Interface design and prototype",
    criteria: [
      "The prototype covers every agreed user flow.",
      "Source files include named components and agreed responsive variants.",
    ],
    evidence: ["link", "application/pdf"],
  },
  {
    id: "graphic_design",
    title: "Graphic design",
    deliverable: "Design assets",
    criteria: [
      "Exports use the agreed dimensions, color space and file formats.",
      "Editable source files and licensed assets are included.",
    ],
    evidence: ["application/zip", "image/png"],
  },
  {
    id: "video",
    title: "Video editing",
    deliverable: "Edited video",
    criteria: [
      "The export meets the agreed duration, resolution and frame rate.",
      "Captions and audio match the approved script and editing brief.",
    ],
    evidence: ["video/mp4"],
  },
  {
    id: "ai_agent",
    title: "AI agent development",
    deliverable: "Agent and evaluation report",
    criteria: [
      "The agent passes the agreed evaluation cases with recorded results.",
      "Tool permissions and failure handling match the approved specification.",
    ],
    evidence: ["link", "application/pdf"],
  },
  {
    id: "writing",
    title: "Content writing",
    deliverable: "Content manuscript",
    criteria: [
      "The content covers every agreed topic and meets the word count range.",
      "References and editing requirements match the approved style guide.",
    ],
    evidence: ["text/plain"],
  },
  {
    id: "software",
    title: "Custom software",
    deliverable: "Software release",
    criteria: [
      "All agreed acceptance tests pass with reproducible instructions.",
      "Source code and deployment documentation are included.",
    ],
    evidence: ["application/zip", "link"],
  },
  {
    id: "custom",
    title: "Custom digital work",
    deliverable: "Agreed deliverable",
    criteria: [
      "The deliverable satisfies the measurable requirements in the project scope.",
    ],
    evidence: ["link"],
  },
];
export function templateProtocol(type: WorkType, count = 1): PapProtocol {
  const t = templates.find((t) => t.id === type)!;
  return {
    version: 1,
    serialization: "pactlance-pap-json-v1",
    execution: "offchain_workflow",
    workType: type,
    timeZone: "UTC",
    reviewTimeout: "human_review",
    requireReviewNotice: true,
    cancellation: "mutual",
    rejection: "revision_then_dispute",
    dispute: "exclusive_primary_then_backup",
    allocation: "original_participants_only",
    rules: [],
    milestones: Array.from({ length: count }, (_, i) => ({
      reviewHours: 72,
      revisionLimit: 2,
      deliverables: [
        {
          id: `deliverable-${i + 1}`,
          title: t.deliverable,
          acceptanceCriteria: [...t.criteria],
          requiredEvidenceTypes: [...t.evidence],
        },
      ],
    })),
  };
}
