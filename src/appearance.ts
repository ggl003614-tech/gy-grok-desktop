export type DeskTheme = "light" | "dark";

export function resolvedDeskTheme(
  root: { dataset: { theme?: string } } = document.documentElement,
): DeskTheme {
  return root.dataset.theme === "dark" ? "dark" : "light";
}

export function grokCliTheme(theme: DeskTheme): "grokday" | "groknight" {
  return theme === "dark" ? "groknight" : "grokday";
}

export function colorFgBg(theme: DeskTheme): string {
  return theme === "dark" ? "15;0" : "0;15";
}

export function xtermTheme(theme: DeskTheme) {
  if (theme === "dark") {
    return {
      background: "#111110",
      foreground: "#ededeb",
      cursor: "#ededeb",
      cursorAccent: "#111110",
      selectionBackground: "#ededeb33",
      black: "#111110",
      red: "#ef6b6b",
      green: "#5dca88",
      yellow: "#d6b66e",
      blue: "#6fa4e7",
      magenta: "#b08ae3",
      cyan: "#65bec5",
      white: "#ededeb",
      brightBlack: "#8d8d86",
      brightRed: "#ef8a8a",
      brightGreen: "#7ad89c",
      brightYellow: "#e2c788",
      brightBlue: "#8cb6ee",
      brightMagenta: "#c2a4ec",
      brightCyan: "#7ecdd3",
      brightWhite: "#ffffff",
    };
  }
  return {
    background: "#ffffff",
    foreground: "#1c1c1a",
    cursor: "#1c1c1a",
    cursorAccent: "#ffffff",
    selectionBackground: "#1c1c1a22",
    black: "#1c1c1a",
    red: "#b42318",
    green: "#1b7a40",
    yellow: "#8a5b00",
    blue: "#185ea5",
    magenta: "#6d4aa8",
    cyan: "#0e7490",
    white: "#f5f5f2",
    brightBlack: "#5f5f59",
    brightRed: "#d92d20",
    brightGreen: "#2f8a4e",
    brightYellow: "#a16207",
    brightBlue: "#1d6ec4",
    brightMagenta: "#7c5cbf",
    brightCyan: "#0e8aa8",
    brightWhite: "#ffffff",
  };
}

export function ansiMutedRgb(theme: DeskTheme): string {
  return theme === "dark" ? "154;154;147" : "95;95;89";
}

export function ansiDangerRgb(): string {
  return "180;35;24";
}
