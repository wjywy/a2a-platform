import type { ThemeConfig } from "antd";

export const platformTheme: ThemeConfig = {
  cssVar: { prefix: "a2a" },
  hashed: true,
  token: {
    // Quiet graphite workspace: ink is the primary action color and semantic
    // tones stay muted so status never competes with the conversation.
    colorPrimary: "#2f2f2f",
    colorSuccess: "#19785a",
    colorWarning: "#9a671f",
    colorError: "#b94b50",
    colorInfo: "#5c5c5c",
    colorText: "#202020",
    colorTextSecondary: "#707070",
    colorBorder: "#dedede",
    colorBgLayout: "#f7f7f7",
    colorBgContainer: "#ffffff",
    borderRadius: 8,
    borderRadiusLG: 12,
    controlHeight: 36,
    controlHeightSM: 30,
    fontSize: 13,
    fontFamily:
      "Aptos, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
    boxShadowSecondary: "0 14px 34px rgb(20 20 20 / 0.12)",
  },
  components: {
    Button: {
      fontWeight: 620,
      primaryShadow: "none",
      defaultShadow: "none",
      dangerShadow: "none",
    },
    Card: { headerFontSize: 14, paddingLG: 18 },
    Checkbox: { colorPrimaryHover: "#4b4b4b" },
    Collapse: {
      headerBg: "#ffffff",
    },
    Input: {
      hoverBorderColor: "#a9a9a9",
    },
    InputNumber: {
      hoverBorderColor: "#a9a9a9",
    },
    Menu: {
      itemHeight: 38,
      itemBorderRadius: 7,
      itemMarginInline: 0,
      itemSelectedBg: "#e9e9e9",
      itemSelectedColor: "#171717",
      itemColor: "#4a4a4a",
      itemHoverBg: "#eeeeee",
      itemHoverColor: "#171717",
    },
    Pagination: {
      itemActiveBg: "#ffffff",
    },
    Segmented: {
      itemHoverBg: "#f1f1f1",
      itemHoverColor: "#171717",
      itemSelectedBg: "#ffffff",
    },
    Select: {
      hoverBorderColor: "#bdbdbd",
      optionActiveBg: "#eeeeee",
      optionSelectedBg: "#e9e9e9",
    },
    Table: {
      headerBg: "#fafafa",
      headerColor: "#6b6b6b",
      headerSplitColor: "transparent",
      rowHoverBg: "#f5f5f5",
      cellPaddingBlockSM: 10,
      cellPaddingInlineSM: 10,
    },
    Tabs: {
      itemHoverColor: "#171717",
      itemSelectedColor: "#171717",
      inkBarColor: "#171717",
      titleFontSize: 12,
    },
    Tag: { borderRadiusSM: 5, defaultBg: "#f0f0f0", defaultColor: "#5d5d5d" },
    Drawer: { paddingLG: 20 },
    Modal: { borderRadiusLG: 12, paddingContentHorizontalLG: 22 },
  },
};
