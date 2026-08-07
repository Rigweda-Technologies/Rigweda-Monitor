export type ThemeId = "emerald" | "ocean" | "indigo" | "amber" | "rose" | "custom";
export type PresetThemeId = Exclude<ThemeId, "custom">;
export type Appearance = "light" | "dark" | "system";

export const themes: Record<PresetThemeId, { label: string; description: string; colors: string[] }> = {
  emerald: { label: "Emerald", description: "Fresh and balanced", colors: ["#075c4b", "#18a37f", "#66d3b4"] },
  ocean: { label: "Ocean", description: "Clear and focused", colors: ["#075985", "#0284c7", "#7dd3fc"] },
  indigo: { label: "Indigo", description: "Calm and confident", colors: ["#3730a3", "#6366f1", "#a5b4fc"] },
  amber: { label: "Amber", description: "Warm and energetic", colors: ["#92400e", "#d97706", "#fcd34d"] },
  rose: { label: "Rose", description: "Bold and welcoming", colors: ["#9f1239", "#e11d48", "#fda4af"] }
};
