import type { ReactNode } from "react";
export function NextAction({
  title,
  children,
  role,
}: {
  title: string;
  children: ReactNode;
  role?: string;
}) {
  return (
    <div className="next-action-card">
      <div className="next-action-icon" aria-hidden="true">
        →
      </div>
      <div>
        <p className="eyebrow">
          {role ? `YOUR NEXT STEP · ${role}` : "YOUR NEXT STEP"}
        </p>
        <h3>{title}</h3>
        <div className="next-action-body">{children}</div>
      </div>
    </div>
  );
}
export function ProgressSteps({
  labels,
  current,
  complete = false,
}: {
  labels: string[];
  current: number;
  complete?: boolean;
}) {
  return (
    <ol className="journey-progress" aria-label="Milestone progress">
      {labels.map((label, i) => (
        <li
          key={label}
          className={
            complete || i < current ? "done" : i === current ? "current" : ""
          }
          aria-current={!complete && i === current ? "step" : undefined}
        >
          <span className="journey-step-number" aria-hidden="true">
            {complete || i < current ? "✓" : i + 1}
          </span>
          <span>
            {label}
            <small>
              {complete || i < current
                ? "Complete"
                : i === current
                  ? "Current step"
                  : "Coming next"}
            </small>
          </span>
        </li>
      ))}
    </ol>
  );
}
