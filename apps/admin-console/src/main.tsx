import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import ConsoleApp from "./App";
import { platformTheme } from "./theme";
import "antd/dist/reset.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={platformTheme}>
      <AntApp>
        <ConsoleApp />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
