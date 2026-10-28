import { run } from "./run";

/**
 * The only key presses this extension ever sends to Zed, and only for the opt-in "type the resume
 * command into a new Zed terminal" setting. There is deliberately no way to send any other key:
 * no Return (so nothing is ever run), no typing of text, no arbitrary shortcut.
 */
const KEY_EVENTS = {
  /** Control + Shift + backquote: Zed's default for `workspace::NewTerminal`. */
  "new-terminal": { keyCode: 50, flags: 0x40000 | 0x20000 },
  /** Command + V: pastes the clipboard into whatever Zed has focused. */
  paste: { keyCode: 9, flags: 0x100000 },
} as const;

export type ZedKey = keyof typeof KEY_EVENTS;

/** Sends one key press straight to the Zed process, not to whichever app is in front. */
export async function postZedKey(pid: number, key: ZedKey): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("Invalid Zed process");
  const event = Object.prototype.hasOwnProperty.call(KEY_EVENTS, key) ? KEY_EVENTS[key] : undefined;
  if (event === undefined) throw new Error(`Refusing to send an unlisted key: ${String(key)}`);

  // pid, key code and flags arrive as arguments, never as script text.
  const script = `ObjC.import("ApplicationServices");
function run(argv) {
  const pid = Number(argv[0]), keyCode = Number(argv[1]), flags = Number(argv[2]);
  for (const down of [true, false]) {
    const event = $.CGEventCreateKeyboardEvent($(), keyCode, down);
    $.CGEventSetFlags(event, flags);
    $.CGEventPostToPid(pid, event);
    delay(0.04);
  }
}`;
  await run("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    script,
    String(pid),
    String(event.keyCode),
    String(event.flags),
  ]);
}

/** The pid of the application that currently has the keyboard, or null when it cannot be read. */
export async function frontmostPid(): Promise<number | null> {
  const script = `ObjC.import("AppKit");
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
app.isNil() ? "" : String(Number(app.processIdentifier));`;
  const pid = Number.parseInt((await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script])).trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}
