import type { NavItem } from "./nav-config";

export interface Command {
  id: string;
  group: string;
  label: string;
  hint: string;
  href: string;
  item: NavItem;
}

/**
 * Every query word must appear somewhere in the label or hint. Label matches
 * rank above hint-only matches, and prefix matches above the rest.
 */
export function searchCommands(commands: Command[], query: string, limit = 12): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands.slice(0, limit);

  const scored = commands
    .map((command) => {
      const label = command.label.toLowerCase();
      const haystack = `${label} ${command.hint.toLowerCase()}`;
      if (!words.every((word) => haystack.includes(word))) return null;
      const score = words.reduce(
        (total, word) => total + (label.startsWith(word) ? 3 : label.includes(word) ? 2 : 0),
        0,
      );
      return { command, score };
    })
    .filter((entry): entry is { command: Command; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.command);
}
