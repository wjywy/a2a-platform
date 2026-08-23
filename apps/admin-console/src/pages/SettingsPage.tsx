import { useState } from "react";
import { Button, Form, Input, Typography } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type PlatformSetting } from "../api";
import { useAsync } from "../hooks";
import {
  Field,
  FormActions,
  Modal,
  PageState,
  SectionHeader,
  formatTime,
  useToast,
} from "../ui";
import styles from "../App.module.css";
export function SettingsPage() {
  const { token } = useApp();
  const settings = useAsync(() => platformApi.settings(token), [token]);
  const [selected, setSelected] = useState<PlatformSetting>();
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="平台参数"
          description="修改后由对应服务在下一次读取周期生效；敏感值不会回显"
        />
        <PageState
          loading={settings.loading}
          error={settings.error}
          empty={!settings.data?.length ? "暂无平台参数" : undefined}
          retry={() => void settings.refresh()}
        >
          <div className={styles.settingsList}>
            {settings.data?.map((item) => (
              <Button
                type="text"
                block
                key={item.key}
                onClick={() => setSelected(item)}
              >
                <span className={styles.settingsRow}>
                  <span>
                    <Typography.Text code>{item.key}</Typography.Text>
                    <Typography.Paragraph>
                      {item.description}
                    </Typography.Paragraph>
                  </span>
                  <strong>
                    {typeof item.value === "object"
                      ? JSON.stringify(item.value)
                      : String(item.value)}
                  </strong>
                  <small>
                    {item.updatedBy} · {formatTime(item.updatedAt)}
                  </small>
                  <RightOutlined />
                </span>
              </Button>
            ))}
          </div>
        </PageState>
      </section>
      <section className={styles.panel}>
        <SectionHeader title="运行信息" />
        <div className={styles.systemGrid}>
          <div>
            <span>管理 API</span>
            <b>/api/admin</b>
            <small>Bearer JWT / dev-admin-token</small>
          </div>
          <div>
            <span>A2A 网关</span>
            <b>/agents/:slug/a2a/rest</b>
            <small>X-API-Key</small>
          </div>
          <div>
            <span>事件传输</span>
            <b>Server-Sent Events</b>
            <small>禁用代理缓冲</small>
          </div>
          <div>
            <span>协议版本</span>
            <b>A2A 1.0</b>
            <small>HTTP+JSON平台代理</small>
          </div>
        </div>
      </section>
      {selected && (
        <SettingForm
          setting={selected}
          close={() => setSelected(undefined)}
          saved={async () => {
            setSelected(undefined);
            await settings.refresh();
          }}
        />
      )}
    </>
  );
}
function SettingForm({
  setting,
  close,
  saved,
}: {
  setting: PlatformSetting;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [value, setValue] = useState(
    typeof setting.value === "object"
      ? JSON.stringify(setting.value, null, 2)
      : String(setting.value),
  );
  const [description, setDescription] = useState(setting.description);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      let parsed: unknown = value;
      if (!setting.sensitive) {
        try {
          parsed = JSON.parse(value);
        } catch {
          /* 普通字符串 */
        }
      }
      await platformApi.updateSetting(token, setting.key, parsed, description);
      toast.success("平台参数已更新");
      await saved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="编辑平台参数" description={setting.key} onClose={close}>
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field
          label="值"
          hint={
            setting.sensitive
              ? "敏感值保存后不会回显"
              : "支持 JSON、数字、布尔值或字符串"
          }
        >
          <Input.TextArea
            rows={6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Field label="说明">
          <Input.TextArea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FormActions cancel={close} submit="保存参数" busy={busy} />
      </Form>
    </Modal>
  );
}
