// Single source of truth for navigation - grouped exactly the way the
// supplied mockup's NAV array groups it (Overview / Care / Records /
// Support / Account), shared by the desktop sidebar, the mobile "More"
// sheet, and the mobile bottom tab bar.
export const NAV_GROUPS = [
  {
    key: "overview",
    labelKey: "navgroup.overview",
    items: [{ to: "/", labelKey: "nav.home", icon: "ph-house" }],
  },
  {
    key: "care",
    labelKey: "navgroup.care",
    items: [
      { to: "/assess", labelKey: "nav.health", icon: "ph-stethoscope" },
      { to: "/guide", labelKey: "nav.guide", icon: "ph-baby" },
      { to: "/nutrition", labelKey: "nav.nutrition", icon: "ph-bowl-food" },
      { to: "/mental-wellness", labelKey: "nav.psych", icon: "ph-heart" },
      { to: "/postpartum", labelKey: "nav.postpartum", icon: "ph-baby-carriage" },
    ],
  },
  {
    key: "records",
    labelKey: "navgroup.records",
    items: [
      { to: "/reports", labelKey: "nav.reports", icon: "ph-file-text" },
      { to: "/history", labelKey: "nav.history", icon: "ph-chart-line-up" },
    ],
  },
  {
    key: "support",
    labelKey: "navgroup.support",
    items: [{ to: "/help", labelKey: "nav.help", icon: "ph-phone" }],
  },
  {
    key: "account",
    labelKey: "navgroup.account",
    items: [
      { to: "/profile", labelKey: "nav.profile", icon: "ph-user" },
      { to: "/privacy", labelKey: "nav.privacy", icon: "ph-lock" },
    ],
  },
];

// The mobile bottom tab bar shows 4 primary destinations plus a "More"
// button that opens the full grouped sheet - matches the mockup's
// mainTabs = ['home','check','pregnancy','history'].
export const MOBILE_TABS = [
  { to: "/", labelKey: "nav.home", icon: "ph-house" },
  { to: "/assess", labelKey: "nav.health", icon: "ph-stethoscope" },
  { to: "/guide", labelKey: "nav.guide", icon: "ph-baby" },
  { to: "/history", labelKey: "nav.history", icon: "ph-chart-line-up" },
];

export const ALL_LINKS = NAV_GROUPS.flatMap((g) => g.items);
