import { Action, ActionPanel, Icon } from "@raycast/api";
import { formatHomePath } from "../lib/format";
import { STATUS_LABELS, StatusFilter } from "../lib/session-status";

export interface FilterProps {
  readonly status: StatusFilter;
  readonly project: string;
  readonly projects: readonly string[];
  readonly onStatus: (status: StatusFilter) => void;
  readonly onProject: (project: string) => void;
}

export function SessionFilters({ status, project, projects, onStatus, onProject }: FilterProps) {
  return (
    <ActionPanel.Submenu
      title="Filter Sessions"
      icon={Icon.Filter}
      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
    >
      <ActionPanel.Section title="Status">
        {(Object.keys(STATUS_LABELS) as StatusFilter[])
          .filter((value) => value !== "zed")
          .map((value) => (
            <Action
              key={value}
              title={STATUS_LABELS[value]}
              icon={status === value ? Icon.Checkmark : Icon.Circle}
              onAction={() => onStatus(value)}
            />
          ))}
      </ActionPanel.Section>
      <ActionPanel.Submenu title="Project" icon={Icon.Folder}>
        <Action
          title="All Projects"
          icon={project === "" ? Icon.Checkmark : Icon.Folder}
          onAction={() => onProject("")}
        />
        {projects.map((cwd) => (
          <Action
            key={cwd}
            title={formatHomePath(cwd)}
            icon={project === cwd ? Icon.Checkmark : Icon.Folder}
            onAction={() => onProject(cwd)}
          />
        ))}
      </ActionPanel.Submenu>
      <Action
        title="Reset Filters"
        icon={Icon.ArrowCounterClockwise}
        onAction={() => {
          onStatus("all");
          onProject("");
        }}
      />
    </ActionPanel.Submenu>
  );
}
