import { ActionPanel, Color, getPreferenceValues, Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SessionActions } from "./components/session-actions";
import { SessionDetail } from "./components/session-detail";
import { formatHomePath } from "./lib/format";
import { TranscriptMessage } from "./lib/messages";
import { readProviderMessages } from "./lib/provider-messages";
import { TerminalApp } from "./lib/resume";
import { invalidateAgents } from "./lib/agents";
import { applyRuntimeSnapshot, readLiveSnapshot, loadSessionSnapshot, SessionItem } from "./lib/sessions";
import { ProviderId, providerLabel } from "./lib/session-types";
import { matchesStatus, StatusFilter, STATUS_LABELS } from "./lib/session-status";
import { SessionFilters } from "./components/session-filters";

const PROVIDER_COLORS = { claude: Color.Orange, codex: Color.Blue };
const GROUP_META = { active: { section: "Open Sessions" }, history: { section: "History" } };
type Group = keyof typeof GROUP_META;
const SECTION_ORDER: readonly Group[] = ["active", "history"];

function activityPriority(item: SessionItem): number {
  return item.state === "working" ? 0 : item.state === "waiting" ? 1 : 2;
}

const NO_MESSAGES: readonly TranscriptMessage[] = Object.freeze([]);
const NO_SESSIONS: readonly SessionItem[] = Object.freeze([]);

interface Preferences {
  readonly terminalApp?: TerminalApp;
  readonly editorApp?: string;
  readonly claudeBin?: string;
  readonly codexBin?: string;
  readonly historyLimit?: string;
}

async function preview(provider: ProviderId, path: string) {
  return readProviderMessages(provider, path, 10);
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const parsed = Number.parseInt(preferences.historyLimit ?? "80", 10);
  const historyLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 80;
  const terminal: TerminalApp = preferences.terminalApp === "iTerm" ? "iTerm" : "Terminal";
  const editor = preferences.editorApp?.trim() || "Zed";
  const claudeBin = preferences.claudeBin?.trim() || "claude";
  const codexBin = preferences.codexBin?.trim() || "codex";
  const [showDetail, setShowDetail] = useState(false);
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [project, setProject] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const {
    data: snapshot,
    isLoading,
    error,
    revalidate,
  } = useCachedPromise(loadSessionSnapshot, [historyLimit, claudeBin], {
    keepPreviousData: true,
  });
  const {
    data: live,
    error: liveError,
    revalidate: revalidateLive,
  } = useCachedPromise(readLiveSnapshot, [snapshot?.items ?? NO_SESSIONS], { keepPreviousData: true });
  useEffect(() => {
    const liveTimer = setInterval(() => {
      void revalidateLive();
    }, 3_000);
    const fullTimer = setInterval(() => {
      void revalidate();
    }, 30_000);
    return () => {
      clearInterval(liveTimer);
      clearInterval(fullTimer);
    };
  }, [revalidate, revalidateLive]);

  const data = useMemo(() => {
    const items = snapshot?.items ?? [];
    return live && !liveError && live.observedAt > (snapshot?.observedAt ?? 0)
      ? applyRuntimeSnapshot(items, live)
      : items;
  }, [snapshot, live, liveError]);
  const selected = data.find((item) => item.key === selectedKey);
  const { data: messages = [], isLoading: readingMessages } = useCachedPromise(
    preview,
    [selected?.provider ?? "claude", selected?.transcript?.path ?? ""],
    {
      initialData: [] as TranscriptMessage[],
      keepPreviousData: false,
      execute: showDetail && Boolean(selected?.transcript),
    },
  );
  const projects = useMemo(() => [...new Set(data.map((item) => item.cwd).filter(Boolean))].sort(), [data]);
  const visible = useMemo(
    () =>
      data.filter(
        (item) =>
          (provider === "all" || item.provider === provider) &&
          (!project || item.cwd === project) &&
          matchesStatus(item, status, "unknown"),
      ),
    [data, provider, project, status],
  );
  const filters = {
    status,
    project,
    projects,
    onStatus: setStatus,
    onProject: setProject,
  };
  const sections = useMemo(() => {
    const result = new Map<Group, SessionItem[]>();
    for (const item of visible) {
      const group: Group = item.live ? "active" : "history";
      const bucket = result.get(group) ?? [];
      bucket.push(item);
      result.set(group, bucket);
    }
    result.get("active")?.sort((a, b) => activityPriority(a) - activityPriority(b));
    return result;
  }, [visible]);
  const refresh = useCallback(() => {
    invalidateAgents();
    void revalidate();
    void revalidateLive();
  }, [revalidate, revalidateLive]);
  const toggle = useCallback(() => setShowDetail((value) => !value), []);
  const warnings = [
    ...(snapshot?.warnings ?? []),
    ...(error ? ["Could not refresh sessions; showing cached data"] : []),
    ...(liveError || live?.claude === null ? ["Claude live status could not be refreshed"] : []),
    ...(live?.codex === null ? ["Codex live status could not be refreshed"] : []),
  ];

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      onSelectionChange={setSelectedKey}
      navigationTitle="Coding Agent Sessions"
      actions={
        <ActionPanel>
          <SessionFilters {...filters} />
        </ActionPanel>
      }
      searchBarPlaceholder={`Search ${visible.length} sessions${status !== "all" ? ` · ${STATUS_LABELS[status]}` : ""}${project ? ` · ${formatHomePath(project)}` : ""}`}
      searchBarAccessory={
        <List.Dropdown tooltip="Agent" value={provider} onChange={setProvider} storeValue>
          <List.Dropdown.Item title="All Agents" value="all" />
          <List.Dropdown.Item
            title="Claude Code"
            value="claude"
            icon={{ source: Icon.CircleFilled, tintColor: PROVIDER_COLORS.claude }}
          />
          <List.Dropdown.Item
            title="Codex"
            value="codex"
            icon={{ source: Icon.CircleFilled, tintColor: PROVIDER_COLORS.codex }}
          />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Terminal}
        title={isLoading ? "Reading Sessions…" : "No Sessions Found"}
        description="Change the agent above or use Filter Sessions (Cmd+Shift+F)."
        actions={
          <ActionPanel>
            <SessionFilters {...filters} />
          </ActionPanel>
        }
      />
      {warnings.length ? (
        <List.Section title="Data Source Notices">
          {warnings.map((warning) => (
            <List.Item key={warning} title={warning} icon={Icon.Warning} />
          ))}
        </List.Section>
      ) : null}
      {SECTION_ORDER.map((group) => {
        const items = sections.get(group);
        if (!items?.length) return null;
        return (
          <List.Section
            key={group}
            title={GROUP_META[group].section}
            subtitle={`${items.length} ${group === "active" ? "running" : "saved"}`}
          >
            {items.map((item) => (
              <List.Item
                key={item.key}
                id={item.key}
                title={item.title}
                icon={{
                  source: group === "history" ? Icon.Clock : Icon.CircleFilled,
                  tintColor: group === "history" ? Color.SecondaryText : PROVIDER_COLORS[item.provider],
                }}
                subtitle={showDetail ? item.project : formatHomePath(item.cwd)}
                keywords={[
                  item.sessionId,
                  item.provider,
                  providerLabel(item.provider),
                  item.cwd,
                  item.gitBranch,
                  item.source,
                ]}
                accessories={[
                  ...(provider === "all"
                    ? [
                        {
                          tag: {
                            value: item.provider === "claude" ? "Claude" : "Codex",
                            color: PROVIDER_COLORS[item.provider],
                          },
                        },
                      ]
                    : []),
                  ...(item.live && (item.state === "working" || item.state === "waiting")
                    ? [
                        {
                          tag: {
                            value: item.state === "working" ? "Working" : "Idle",
                            color: item.state === "working" ? Color.Yellow : Color.SecondaryText,
                          },
                          tooltip: "Confirmed session activity",
                        },
                      ]
                    : []),
                ]}
                detail={
                  <SessionDetail
                    item={item}
                    messages={item.key === selectedKey ? messages : NO_MESSAGES}
                    isLoadingMessages={readingMessages && item.key === selectedKey}
                  />
                }
                actions={
                  <SessionActions
                    item={item}
                    terminal={terminal}
                    editor={editor}
                    claudeBin={claudeBin}
                    codexBin={codexBin}
                    onRefresh={refresh}
                    onToggleDetail={toggle}
                    filters={filters}
                  />
                }
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}
