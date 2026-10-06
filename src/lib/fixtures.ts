import type { Project } from "./domain";
export const demoProject: Project = {
  id: "demo-video-project",
  title: "Short-form video series",
  client: "Example Studio",
  freelancer: "Demo freelancer",
  milestones: [
    {
      id: "batch-1",
      sequence: 1,
      title: "First five videos",
      amountUnits: 250_000_000n,
      status: "ready",
      deliverables:
        "5 vertical MP4 videos · 1080 × 1920 · 30–60 seconds · captions from the agreed script",
    },
    {
      id: "batch-2",
      sequence: 2,
      title: "Remaining five videos",
      amountUnits: 250_000_000n,
      status: "ready",
      deliverables:
        "5 additional vertical MP4 videos using the second batch of supplied clips",
    },
  ],
};
