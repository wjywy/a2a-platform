import type { ThemeConfig } from "antd";

export const platformTheme: ThemeConfig = {
  cssVar: { prefix: "a2a" },
  hashed: true,
  token: {
    // ChatGPT-inspired neutral base: black is the product action color, while
    // blue is reserved for the conversational send affordance in Agent Studio.
    colorPrimary: "#212121",
    colorSuccess: "#157a56",
    colorWarning: "#a86615",
    colorError: "#c74444",
    colorInfo: "#212121",
    colorText: "#171717",
    colorTextSecondary: "#6b6b6b",
    colorBorder: "#e5e5e5",
    colorBgLayout: "#f7f7f8",
    colorBgContainer: "#ffffff",
    borderRadius: 8,
    borderRadiusLG: 12,
    controlHeight: 36,
    controlHeightSM: 30,
    fontSize: 13,
    fontFamily:
      "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
    boxShadowSecondary: "0 14px 36px rgb(0 0 0 / 0.12)",
  },
  components: {
    Button: { fontWeight: 620, primaryShadow: "none" },
    Card: { headerFontSize: 14, paddingLG: 18 },
    Checkbox: { colorPrimaryHover: "#4b4b4b" },
    Collapse: {
      headerBg: "#ffffff",
    },
    Input: {
      hoverBorderColor: "#bdbdbd",
    },
    InputNumber: {
      hoverBorderColor: "#bdbdbd",
    },
    Menu: {
      itemHeight: 38,
      itemBorderRadius: 7,
      itemMarginInline: 0,
      itemSelectedBg: "#ececec",
      itemSelectedColor: "#171717",
      itemColor: "#4a4a4a",
      itemHoverBg: "#f1f1f1",
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
      optionActiveBg: "#f1f1f1",
      optionSelectedBg: "#ececec",
    },
    Table: {
      headerBg: "#fafafa",
      headerColor: "#6b6b6b",
      headerSplitColor: "transparent",
      rowHoverBg: "#f6f6f6",
      cellPaddingBlockSM: 10,
      cellPaddingInlineSM: 10,
    },
    Tabs: {
      itemHoverColor: "#171717",
      itemSelectedColor: "#171717",
      inkBarColor: "#171717",
      titleFontSize: 12,
    },
    Tag: { borderRadiusSM: 5 },
  },
};
