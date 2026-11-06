/**
 * Ten themes for the Bentley Hotel site. Each supplies CSS custom properties (the same names
 * styles.css defines on :root), a typeface pairing and layout flags that the renderer puts on
 * <body> as data-attributes (styles.css has rules for each value).
 *
 * layout.header:   classic | centred | minimal
 * layout.hero:     split | banner
 * layout.buttons:  square | rounded | pill
 * layout.sections: bands | flat
 */

const fontUrl = (families) =>
  "https://fonts.googleapis.com/css2?" + families.map((f) => "family=" + f).join("&") + "&display=swap";

export const THEMES = {
  "heritage-green": {
    name: "Heritage Green",
    description: "The original look: deep green, brass and warm cream, Cormorant headings.",
    vars: {
      "green-950": "#102420", "green-900": "#17302a", "green-800": "#1e3d35", "green-700": "#285046", "green-100": "#e3ece8",
      "brass-500": "#b8925a", "brass-600": "#8a6838", "brass-700": "#7d5e31",
      "sand-100": "#f6efe2", cream: "#faf6ef", paper: "#fffdf9", ink: "#1d2320", "ink-soft": "#3c4440", muted: "#5d6661",
      line: "#e3d9c8", "line-strong": "#cdbfa6", focus: "#7d5e31", "hero-accent": "#ecd3a5",
    },
    fonts: { display: '"Cormorant Garamond", "Iowan Old Style", Georgia, serif', body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Cormorant+Garamond:ital,wght@0,500;0,600;1,500", "Source+Sans+3:wght@400;600"]) },
    layout: { header: "classic", hero: "split", buttons: "square", sections: "bands" },
  },
  "sandstone-slate": {
    name: "Sandstone & Slate",
    description: "Slate blue-grey bands with sandstone accents, Playfair Display headings, centred header.",
    vars: {
      "green-950": "#222b33", "green-900": "#2f3b45", "green-800": "#3a4854", "green-700": "#4a5b69", "green-100": "#e8ecef",
      "brass-500": "#c08a4c", "brass-600": "#9a6a33", "brass-700": "#7f562a",
      "sand-100": "#f4ede3", cream: "#f9f5ee", paper: "#fffdfa", ink: "#22262a", "ink-soft": "#40464c", muted: "#626a71",
      line: "#e4dccd", "line-strong": "#cfc3ad", focus: "#7f562a", "hero-accent": "#f0d9b3",
    },
    fonts: { display: '"Playfair Display", Georgia, serif', body: '"Lato", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Playfair+Display:ital,wght@0,500;0,600;1,500", "Lato:wght@400;700"]) },
    layout: { header: "centred", hero: "split", buttons: "square", sections: "bands" },
  },
  "midnight-brass": {
    name: "Midnight Brass",
    description: "A dark theme: near-black pages, brass highlights, Cormorant headings, pill buttons.",
    vars: {
      "green-950": "#07100e", "green-900": "#0c1714", "green-800": "#122019", "green-700": "#1b2e27", "green-100": "#1e2a27",
      "brass-500": "#d3ad6c", "brass-600": "#b8925a", "brass-700": "#c9a265",
      "sand-100": "#1b2220", cream: "#171d1b", paper: "#121716", ink: "#ebe7dd", "ink-soft": "#cfd2c9", muted: "#a2aaa3",
      line: "#2a3331", "line-strong": "#3b4643", focus: "#ecd3a5", "hero-accent": "#ecd3a5",
      "header-bg": "rgba(18, 23, 22, 0.94)", "card-bg": "#171d1b", "input-bg": "#1f2624", "stat-bg": "#171d1b",
    },
    fonts: { display: '"Cormorant Garamond", Georgia, serif', body: '"Inter", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Cormorant+Garamond:ital,wght@0,500;0,600;1,500", "Inter:wght@400;600"]) },
    layout: { header: "classic", hero: "split", buttons: "pill", sections: "flat" },
    dark: true,
  },
  "clyde-blue": {
    name: "Clyde Blue",
    description: "Navy bands and copper accents on a cool off-white, Libre Baskerville headings, full-width hero.",
    vars: {
      "green-950": "#0f2236", "green-900": "#16304a", "green-800": "#1d3d5c", "green-700": "#285073", "green-100": "#e4ebf2",
      "brass-500": "#c98a52", "brass-600": "#a56a3a", "brass-700": "#86552e",
      "sand-100": "#eef1f4", cream: "#f5f7f9", paper: "#ffffff", ink: "#1a222b", "ink-soft": "#3a4653", muted: "#5f6b78",
      line: "#dde3e9", "line-strong": "#c3ccd5", focus: "#86552e", "hero-accent": "#f3d7b6",
    },
    fonts: { display: '"Libre Baskerville", Georgia, serif', body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Libre+Baskerville:ital,wght@0,400;0,700;1,400", "Source+Sans+3:wght@400;600"]) },
    layout: { header: "classic", hero: "banner", buttons: "rounded", sections: "bands" },
  },
  "tartan-red": {
    name: "Tartan Red",
    description: "Deep claret bands with old-gold accents and a minimal header. Festive and Scottish.",
    vars: {
      "green-950": "#4e141c", "green-900": "#6e1f2a", "green-800": "#822634", "green-700": "#9a3443", "green-100": "#f3e4e6",
      "brass-500": "#d2ad5e", "brass-600": "#a4813a", "brass-700": "#856830",
      "sand-100": "#f8efe6", cream: "#fbf6ef", paper: "#fffcf8", ink: "#241d1e", "ink-soft": "#443b3d", muted: "#6a5f61",
      line: "#e8dccf", "line-strong": "#d3c2ae", focus: "#856830", "hero-accent": "#f1dcb4",
    },
    fonts: { display: '"Cormorant Garamond", Georgia, serif', body: '"Nunito Sans", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Cormorant+Garamond:ital,wght@0,500;0,600;1,500", "Nunito+Sans:wght@400;700"]) },
    layout: { header: "minimal", hero: "split", buttons: "square", sections: "bands" },
  },
  "modern-minimal": {
    name: "Modern Minimal",
    description: "White space, black type, a single green accent, Inter throughout, flat sections and square buttons.",
    vars: {
      "green-950": "#111111", "green-900": "#1a1a1a", "green-800": "#242424", "green-700": "#1e6b4f", "green-100": "#eaf3ee",
      "brass-500": "#2d8a66", "brass-600": "#1e6b4f", "brass-700": "#17553f",
      "sand-100": "#f3f3f1", cream: "#f8f8f6", paper: "#ffffff", ink: "#161616", "ink-soft": "#3a3a3a", muted: "#666666",
      line: "#e6e6e3", "line-strong": "#cfcfca", focus: "#17553f", "hero-accent": "#bfe3d1",
    },
    fonts: { display: '"Inter", "Segoe UI", system-ui, sans-serif', body: '"Inter", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Inter:wght@400;600;700"]) },
    layout: { header: "minimal", hero: "banner", buttons: "square", sections: "flat" },
  },
  "terracotta-cream": {
    name: "Terracotta & Cream",
    description: "Warm cream pages, chocolate-brown bands and terracotta accents, Fraunces headings, rounded corners.",
    vars: {
      "green-950": "#2b1f1b", "green-900": "#3d2c26", "green-800": "#4b3730", "green-700": "#5e463d", "green-100": "#f2e7e0",
      "brass-500": "#c9704f", "brass-600": "#b4553a", "brass-700": "#93452f",
      "sand-100": "#f6ebdf", cream: "#fbf3ea", paper: "#fffaf4", ink: "#2a221f", "ink-soft": "#4a3f3a", muted: "#6f635d",
      line: "#eadcce", "line-strong": "#d6c3b0", focus: "#93452f", "hero-accent": "#f6cdb0",
    },
    fonts: { display: '"Fraunces", Georgia, serif', body: '"Work Sans", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500", "Work+Sans:wght@400;600"]) },
    layout: { header: "classic", hero: "split", buttons: "rounded", sections: "bands" },
  },
  "forest-gold": {
    name: "Forest & Gold",
    description: "Darker forest green with gold accents, Playfair Display headings and a full-width hero.",
    vars: {
      "green-950": "#102118", "green-900": "#1b3a2a", "green-800": "#224734", "green-700": "#2c5a43", "green-100": "#e2ede6",
      "brass-500": "#d4b25a", "brass-600": "#a8862f", "brass-700": "#8a6e26",
      "sand-100": "#f5f0e2", cream: "#faf7ee", paper: "#fdfbf5", ink: "#1b211d", "ink-soft": "#39433d", muted: "#5c655f",
      line: "#e2dcc8", "line-strong": "#cbc2a4", focus: "#8a6e26", "hero-accent": "#f0dc9a",
    },
    fonts: { display: '"Playfair Display", Georgia, serif', body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Playfair+Display:ital,wght@0,500;0,600;1,500", "Source+Sans+3:wght@400;600"]) },
    layout: { header: "classic", hero: "banner", buttons: "square", sections: "bands" },
  },
  "monochrome-editorial": {
    name: "Monochrome Editorial",
    description: "Black, white and grey with a single brass accent, Libre Caslon headings and IBM Plex Sans, centred header.",
    vars: {
      "green-950": "#0d0d0d", "green-900": "#161616", "green-800": "#222222", "green-700": "#333333", "green-100": "#ededed",
      "brass-500": "#b8925a", "brass-600": "#8a6838", "brass-700": "#6f5330",
      "sand-100": "#f1f1f0", cream: "#f7f7f6", paper: "#ffffff", ink: "#111111", "ink-soft": "#333333", muted: "#5e5e5e",
      line: "#e2e2e0", "line-strong": "#c9c9c6", focus: "#6f5330", "hero-accent": "#e8d9bf",
    },
    fonts: { display: '"Libre Caslon Text", Georgia, serif', body: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Libre+Caslon+Text:ital,wght@0,400;0,700;1,400", "IBM+Plex+Sans:wght@400;600"]) },
    layout: { header: "centred", hero: "split", buttons: "square", sections: "flat" },
  },
  "coastal-teal": {
    name: "Coastal Teal",
    description: "Teal to match the bedrooms, sand accents, Cormorant headings and Mulish, pill buttons.",
    vars: {
      "green-950": "#163f42", "green-900": "#1f5f63", "green-800": "#246d72", "green-700": "#2c7f85", "green-100": "#e2f0f0",
      "brass-500": "#d1a66a", "brass-600": "#a97d44", "brass-700": "#8a6538",
      "sand-100": "#f3efe6", cream: "#f8f6f0", paper: "#fbfbf8", ink: "#1c2426", "ink-soft": "#3b4648", muted: "#5f6b6d",
      line: "#e0ddd1", "line-strong": "#c7c2b0", focus: "#8a6538", "hero-accent": "#f1dcb4",
    },
    fonts: { display: '"Cormorant Garamond", Georgia, serif', body: '"Mulish", "Segoe UI", system-ui, sans-serif',
      google: fontUrl(["Cormorant+Garamond:ital,wght@0,500;0,600;1,500", "Mulish:wght@400;700"]) },
    layout: { header: "classic", hero: "split", buttons: "pill", sections: "bands" },
  },
};

export const DEFAULT_THEME = "heritage-green";

export function getTheme(id) {
  return THEMES[id] ? { id, ...THEMES[id] } : { id: DEFAULT_THEME, ...THEMES[DEFAULT_THEME] };
}

/** Inline <style> for the <head>: the theme's variables override the defaults in styles.css. */
export function themeStyle(theme) {
  const vars = Object.entries(theme.vars).map(([k, v]) => `--${k}: ${v};`).join(" ");
  return `<style id="theme">:root { ${vars} --font-display: ${theme.fonts.display}; --font-body: ${theme.fonts.body}; }</style>`;
}

/** Summary for the admin theme picker (no functions, JSON-safe). */
export function listThemes() {
  return Object.entries(THEMES).map(([id, t]) => ({
    id, name: t.name, description: t.description, dark: Boolean(t.dark), layout: t.layout,
    swatch: [t.vars["green-900"], t.vars["brass-600"], t.vars.cream, t.vars.ink],
    fonts: { display: t.fonts.display.split(",")[0].replace(/"/g, ""), body: t.fonts.body.split(",")[0].replace(/"/g, "") },
  }));
}
