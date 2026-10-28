import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { focusWindowTitle, listWindowTitles } from "../lib/windows";

export function ZedWindowPicker() {
  const { data = [], isLoading, revalidate } = useCachedPromise(listWindowTitles, ["zed"]);
  return (
    <List isLoading={isLoading} navigationTitle="Choose Zed Window" searchBarPlaceholder="Choose a window by its title">
      <List.EmptyView
        title="No Zed windows could be read"
        description="Open Zed and allow Raycast Accessibility access in macOS settings."
      />
      {data.map((title, index) => {
        const duplicate = data.filter((entry) => entry === title).length > 1;
        return (
          <List.Item
            key={`${title}-${index}`}
            title={title}
            subtitle={
              duplicate
                ? "Identical titles; select this window in Zed manually"
                : "Window title; project path is not verified"
            }
            actions={
              <ActionPanel>
                {!duplicate ? (
                  <Action
                    title="Focus This Zed Window"
                    icon={Icon.AppWindow}
                    onAction={async () => {
                      const focused = await focusWindowTitle("zed", title);
                      await showToast({
                        style: focused ? Toast.Style.Success : Toast.Style.Failure,
                        title: focused ? "Moved to Zed window" : "Window changed; choose again",
                      });
                    }}
                  />
                ) : null}
                <Action title="Refresh Windows" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
