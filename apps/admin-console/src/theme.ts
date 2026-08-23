import type { ThemeConfig } from "antd";

export const platformTheme: ThemeConfig = {
  cssVar: { prefix: "a2a" },
  hashed: true,
  token: {
    colorPrimary: "#2468f2",
    colorSuccess: "#14875d",
    colorWarning: "#b66b12",
    colorError: "#cc3f45",
    colorInfo: "#2468f2",
    colorText: "#1f2533",
    colorTextSecondary: "#697488",
    colorBorder: "#e1e6ee",
    colorBgLayout: "#f5f7fa",
    colorBgContainer: "#ffffff",
    borderRadius: 7,
    borderRadiusLG: 11,
    controlHeight: 36,
    controlHeightSM: 30,
    fontSize: 13,
    fontFamily:
      "Aptos, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    boxShadowSecondary: "0 14px 34px rgb(20 37 58 / 0.14)",
  },
  components: {
    Button: { fontWeight: 620, primaryShadow: "none" },
    Card: { headerFontSize: 14, paddingLG: 18 },
    Checkbox: {
      colorPrimaryHover: "#647b9b",
    },
    Collapse: {
      headerBg: "#ffffff",
    },
    Input: {
      hoverBorderColor: "#aebbd0",
    },
    InputNumber: {
      hoverBorderColor: "#aebbd0",
    },
    Menu: {
      itemHeight: 38,
      itemBorderRadius: 7,
      itemMarginInline: 0,
      itemSelectedBg: "#edf4ff",
      itemSelectedColor: "#2468f2",
      itemColor: "#525c6e",
      itemHoverBg: "#f6f8fb",
      itemHoverColor: "#344156",
    },
    Pagination: {
      itemActiveBg: "#ffffff",
    },
    Segmented: {
      itemHoverBg: "#f6f8fb",
      itemHoverColor: "#344156",
      itemSelectedBg: "#ffffff",
    },
    Select: {
      hoverBorderColor: "#aebbd0",
      optionActiveBg: "#f6f8fb",
      optionSelectedBg: "#edf4ff",
    },
    Table: {
      headerBg: "#fafbfc",
      headerColor: "#778195",
      headerSplitColor: "transparent",
      rowHoverBg: "#f8fafc",
      cellPaddingBlockSM: 10,
      cellPaddingInlineSM: 10,
    },
    Tabs: {
      itemHoverColor: "#40506b",
      itemSelectedColor: "#2468f2",
      inkBarColor: "#2468f2",
      titleFontSize: 12,
    },
    Tag: { borderRadiusSM: 5 },
  },
};
