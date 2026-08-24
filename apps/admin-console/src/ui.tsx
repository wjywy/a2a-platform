import {
  App,
  Button,
  Card,
  Drawer as AntDrawer,
  Empty,
  Flex,
  Form,
  Modal as AntModal,
  Pagination as AntPagination,
  Result,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  type StatisticProps,
  type TagProps,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
  LoadingOutlined,
  MinusCircleFilled,
  ReloadOutlined,
} from "@ant-design/icons";
import { createContext, useContext, useState, type ReactNode } from "react";
import styles from "./App.module.css";

export const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
export const formatNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN").format(value);
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};
export const formatDuration = (ms?: number) =>
  ms === undefined
    ? "—"
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(2)} s`;

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};
const ToastContext = createContext<ToastApi>({
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
});
export function ToastProvider({ children }: { children: ReactNode }) {
  const { message } = App.useApp();
  return (
    <ToastContext.Provider
      value={{
        success: (content) => void message.success(content),
        error: (content) => void message.error(content),
        info: (content) => void message.info(content),
      }}
    >
      {children}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function PageState({
  loading,
  error,
  empty,
  children,
  retry,
}: {
  loading?: boolean;
  error?: string;
  empty?: string;
  children?: ReactNode;
  retry?: () => void;
}) {
  if (loading)
    return (
      <Flex className={styles.antStatePanel} vertical align="center" gap={8}>
        <Spin indicator={<LoadingOutlined spin />} size="large" />
        <Typography.Text strong>正在加载数据</Typography.Text>
        <Typography.Text type="secondary">
          请稍候，平台正在同步最新状态。
        </Typography.Text>
      </Flex>
    );
  if (error)
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle={error}
        extra={
          retry ? (
            <Button icon={<ReloadOutlined />} onClick={retry}>
              重新加载
            </Button>
          ) : undefined
        }
      />
    );
  if (empty)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{empty}</Typography.Text>
            <Typography.Text type="secondary">
              当前筛选条件下没有可显示的数据。
            </Typography.Text>
          </Space>
        }
      />
    );
  return <>{children}</>;
}

const statusConfig: Record<
  string,
  { label: string; color: TagProps["color"]; icon: ReactNode }
> = {
  active: { label: "已启用", color: "blue", icon: <CheckCircleFilled /> },
  suspended: { label: "已停用", color: "default", icon: <MinusCircleFilled /> },
  online: { label: "已上线", color: "blue", icon: <CheckCircleFilled /> },
  offline: { label: "已下线", color: "default", icon: <MinusCircleFilled /> },
  degraded: {
    label: "已降级",
    color: "warning",
    icon: <ExclamationCircleFilled />,
  },
  draft: { label: "草稿", color: "default", icon: <InfoCircleFilled /> },
  healthy: { label: "健康", color: "blue", icon: <CheckCircleFilled /> },
  unhealthy: { label: "异常", color: "error", icon: <CloseCircleFilled /> },
  unknown: { label: "待检查", color: "default", icon: <InfoCircleFilled /> },
  invited: { label: "待接受", color: "processing", icon: <InfoCircleFilled /> },
  disabled: { label: "已移除", color: "default", icon: <MinusCircleFilled /> },
  open: { label: "触发中", color: "error", icon: <ExclamationCircleFilled /> },
  acknowledged: {
    label: "已确认",
    color: "warning",
    icon: <InfoCircleFilled />,
  },
  silenced: { label: "已静默", color: "default", icon: <MinusCircleFilled /> },
  resolved: { label: "已恢复", color: "success", icon: <CheckCircleFilled /> },
  pending: { label: "等待投递", color: "default", icon: <InfoCircleFilled /> },
  delivering: {
    label: "投递中",
    color: "processing",
    icon: <LoadingOutlined spin />,
  },
  succeeded: { label: "成功", color: "success", icon: <CheckCircleFilled /> },
  retrying: {
    label: "重试中",
    color: "warning",
    icon: <LoadingOutlined spin />,
  },
  dead_letter: { label: "死信", color: "error", icon: <CloseCircleFilled /> },
  accepted: { label: "已接受", color: "success", icon: <CheckCircleFilled /> },
  revoked: { label: "已撤销", color: "error", icon: <CloseCircleFilled /> },
  working: {
    label: "执行中",
    color: "processing",
    icon: <LoadingOutlined spin />,
  },
  completed: { label: "已完成", color: "success", icon: <CheckCircleFilled /> },
  failed: { label: "失败", color: "error", icon: <CloseCircleFilled /> },
  cancelled: { label: "已取消", color: "default", icon: <MinusCircleFilled /> },
};
export function StatusBadge({ value }: { value: string }) {
  const item = statusConfig[value] ?? {
    label: value,
    color: "default" as const,
    icon: <InfoCircleFilled />,
  };
  return (
    <Tag bordered={false} color={item.color} icon={item.icon}>
      {item.label}
    </Tag>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  width = "normal",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  width?: "normal" | "wide";
}) {
  return (
    <AntModal
      open
      destroyOnHidden
      footer={null}
      width={width === "wide" ? 820 : 520}
      title={
        <Space direction="vertical" size={1}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {description && (
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {description}
            </Typography.Text>
          )}
        </Space>
      }
      onCancel={onClose}
    >
      {children}
    </AntModal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmText = "确认",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <AntModal
      open
      title={title}
      okText={confirmText}
      cancelText="取消"
      okButtonProps={{ danger, loading: busy }}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Typography.Paragraph>{message}</Typography.Paragraph>
    </AntModal>
  );
}

export function Drawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <AntDrawer
      open
      width={560}
      title={
        <Space direction="vertical" size={0}>
          <span>{title}</span>
          {subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {subtitle}
            </Typography.Text>
          )}
        </Space>
      }
      onClose={onClose}
    >
      {children}
    </AntDrawer>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Form.Item
      label={label}
      htmlFor={htmlFor}
      colon={false}
      help={error ?? hint}
      validateStatus={error ? "error" : undefined}
      layout="vertical"
    >
      {children}
    </Form.Item>
  );
}

export function FormActions({
  cancel,
  submit = "保存",
  busy = false,
  danger = false,
}: {
  cancel: () => void;
  submit?: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Flex justify="flex-end" gap={8} className={styles.modalFooter}>
      <Button onClick={cancel}>取消</Button>
      <Button htmlType="submit" type="primary" danger={danger} loading={busy}>
        {submit}
      </Button>
    </Flex>
  );
}

export function SubmitForm({
  onSubmit,
  children,
  className,
}: {
  onSubmit: () => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form
      className={className}
      layout="vertical"
      onFinish={() => void submit()}
    >
      {typeof children === "function"
        ? (children as (busy: boolean) => ReactNode)(busy)
        : children}
    </Form>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <Flex justify="space-between" align="center" className={styles.pagination}>
      <Typography.Text type="secondary">共 {total} 条</Typography.Text>
      {totalPages > 1 && (
        <AntPagination
          size="small"
          current={page}
          total={total}
          pageSize={Math.max(1, Math.ceil(total / totalPages))}
          showSizeChanger={false}
          onChange={onChange}
        />
      )}
    </Flex>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Flex
      className={styles.sectionHeader}
      justify="space-between"
      align="start"
      gap={16}
    >
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        {description && (
          <Typography.Paragraph type="secondary">
            {description}
          </Typography.Paragraph>
        )}
      </div>
      {actions && <Space wrap>{actions}</Space>}
    </Flex>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: StatisticProps["value"];
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const colors = {
    neutral: "#1f2533",
    good: "#14875d",
    warn: "#b66b12",
    bad: "#cc3f45",
  };
  return (
    <Card size="small" className={styles.metricCard}>
      <Statistic
        title={label}
        value={value}
        valueStyle={{ color: colors[tone] }}
      />
      {detail && <Typography.Text type="secondary">{detail}</Typography.Text>}
    </Card>
  );
}

export function CodeBlock({ value }: { value: unknown }) {
  return (
    <Typography.Paragraph className={styles.codeBlock}>
      <pre>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </Typography.Paragraph>
  );
}

export function CopyButton({
  value,
  label = "复制",
}: {
  value: string;
  label?: string;
}) {
  const toast = useToast();
  return (
    <Button
      type="link"
      size="small"
      icon={<CopyOutlined />}
      onClick={() =>
        void navigator.clipboard
          .writeText(value)
          .then(() => toast.success("已复制到剪贴板"))
      }
    >
      {label}
    </Button>
  );
}
