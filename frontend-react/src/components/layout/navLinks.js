// Single source of truth for navigation, shared by the desktop sidebar
// and the mobile bottom nav so the two never drift out of sync.
// "primary" are the 5 the mobile bottom nav shows directly; "more" are
// reachable from the sidebar directly (desktop) or the mobile "More"
// sheet.
export const PRIMARY_LINKS = [
  { to: "/", label: "nav.home", icon: "🏠" },
  { to: "/assess", label: "nav.health", icon: "🩺" },
  { to: "/nutrition", label: "nav.nutrition", icon: "🥗" },
  { to: "/reports", label: "nav.reports", icon: "📄" },
  { to: "/profile", label: "nav.profile", icon: "👤" },
];

export const MORE_LINKS = [
  { to: "/guide", label: "nav.guide", icon: "🤰" },
  { to: "/postpartum", label: "nav.postpartum", icon: "🍼" },
  { to: "/mental-wellness", label: "nav.psych", icon: "💜" },
  { to: "/history", label: "nav.history", icon: "📈" },
  { to: "/help", label: "nav.help", icon: "☎️" },
  { to: "/privacy", label: "nav.privacy", icon: "🔒" },
];

export const ALL_LINKS = [...PRIMARY_LINKS, ...MORE_LINKS];
