//! Thème paramétrable : couleur d'accent et densité, persistés en localStorage
//! et appliqués via les variables CSS de `:root`.

const STORAGE_KEY = "gensheet.theme";

export const ACCENTS = [
  { key: "rose", label: "Rose nébuleuse", hex: "#e05a72" },
  { key: "magenta", label: "Magenta", hex: "#d65b9a" },
  { key: "peri", label: "Périwinkle", hex: "#bb8fe4" },
  { key: "or", label: "Or", hex: "#eeb64f" },
];

export const DENSITIES = [
  { key: "aere", label: "Aéré", cardMin: "184px", gap: "22px", pad: "40px 48px 90px" },
  { key: "equilibre", label: "Équilibré", cardMin: "158px", gap: "18px", pad: "34px 42px 90px" },
  { key: "compact", label: "Compact", cardMin: "132px", gap: "13px", pad: "28px 32px 80px" },
];

const DEFAULTS = { accent: "rose", density: "equilibre" };

export function loadTheme() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTheme(theme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

export function applyTheme(theme) {
  const accent = ACCENTS.find((a) => a.key === theme.accent) ?? ACCENTS[0];
  const density = DENSITIES.find((d) => d.key === theme.density) ?? DENSITIES[1];
  const root = document.documentElement.style;

  root.setProperty("--ac", accent.hex);
  root.setProperty("--ac-soft", rgba(accent.hex, 0.16));
  root.setProperty("--ac-line", rgba(accent.hex, 0.5));
  root.setProperty("--ac-glow", rgba(accent.hex, 0.34));

  root.setProperty("--card-min", density.cardMin);
  root.setProperty("--grid-gap", density.gap);
  root.setProperty("--main-pad", density.pad);
}

/** `#rrggbb` + alpha → `rgba(r, g, b, a)`. */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
