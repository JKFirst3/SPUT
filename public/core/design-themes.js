export const DESIGN_THEMES = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    label: "Klassisches Design",
    primary: "#3b5bf4",
    primaryRgba: "rgba(59,91,244,.68)",
    chartColors: ["#3b5bf4", "#8193f9", "#8b5cf6", "#28b982", "#f4a261", "#e76f8a", "#64748b", "#14b8a6"],
  }),
  miele: Object.freeze({
    id: "miele",
    label: "Dunkelrot",
    primary: "#8c0014",
    primaryRgba: "rgba(140,0,20,.72)",
    chartColors: ["#b0132d", "#d5d2cc", "#6f1a28", "#f59b00", "#8e8982", "#c15c6c", "#71806f", "#eeeae4"],
  }),
});

export function normalizeDesignTheme(value) {
  return value === "miele" ? "miele" : "classic";
}

export function designTheme(value) {
  return DESIGN_THEMES[normalizeDesignTheme(value)];
}
