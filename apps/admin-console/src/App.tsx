import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  platformApi,
  subscribePlatformEvents,
  type Agent,
  type Page,
  type Tenant,
  type PlatformUser,
} from "./api";
import { AppContextProvider, type AppContextValue } from "./AppContext";
import { Layout, type PageKey } from "./Layout";
import { PageState, ToastProvider } from "./ui";
import { useDisclosure, useLocalStorage } from "./hooks";
import { AuthPage } from "./pages/AuthPage";
import shellStyles from "./ConsoleShell.module.css";

const loadOverviewPage = () => import("./pages/OverviewPage");
const loadTenantsPage = () => import("./pages/TenantsPage");
const loadMembersPage = () => import("./pages/MembersPage");
const loadAgentsPage = () => import("./pages/AgentsPage");
const loadDebugPage = () => import("./pages/DebugPage");
const loadTasksPage = () => import("./pages/TasksPage");
const loadUsagePage = () => import("./pages/UsagePage");
const loadWebhooksPage = () => import("./pages/WebhooksPage");
const loadAlertsPage = () => import("./pages/AlertsPage");
const loadAuditPage = () => import("./pages/AuditPage");
const loadSettingsPage = () => import("./pages/SettingsPage");

const OverviewPage = memo(
  lazy(() =>
    loadOverviewPage().then((module) => ({ default: module.OverviewPage })),
  ),
);
const TenantsPage = memo(
  lazy(() =>
    loadTenantsPage().then((module) => ({ default: module.TenantsPage })),
  ),
);
const MembersPage = memo(
  lazy(() =>
    loadMembersPage().then((module) => ({ default: module.MembersPage })),
  ),
);
const AgentsPage = memo(
  lazy(() =>
    loadAgentsPage().then((module) => ({ default: module.AgentsPage })),
  ),
);
const RegisterAgentModal = lazy(() =>
  loadAgentsPage().then((module) => ({ default: module.RegisterAgentModal })),
);
const DebugPage = lazy(() =>
  loadDebugPage().then((module) => ({ default: module.DebugPage })),
);
const TasksPage = memo(
  lazy(() =>
    loadTasksPage().then((module) => ({ default: module.TasksPage })),
  ),
);
const UsagePage = memo(
  lazy(() =>
    loadUsagePage().then((module) => ({ default: module.UsagePage })),
  ),
);
const WebhooksPage = memo(
  lazy(() =>
    loadWebhooksPage().then((module) => ({ default: module.WebhooksPage })),
  ),
);
const AlertsPage = memo(
  lazy(() =>
    loadAlertsPage().then((module) => ({ default: module.AlertsPage })),
  ),
);
const AuditPage = memo(
  lazy(() =>
    loadAuditPage().then((module) => ({ default: module.AuditPage })),
  ),
);
const SettingsPage = memo(
  lazy(() =>
    loadSettingsPage().then((module) => ({ default: module.SettingsPage })),
  ),
);

type ConsolePageKey = Exclude<PageKey, "debug">;

const consolePageOrder: ConsolePageKey[] = [
  "overview",
  "agents",
  "tasks",
  "usage",
  "tenants",
  "members",
  "webhooks",
  "alerts",
  "audit",
  "settings",
];

const pagePreloaders: Record<PageKey, () => Promise<unknown>> = {
  overview: loadOverviewPage,
  tenants: loadTenantsPage,
  members: loadMembersPage,
  agents: loadAgentsPage,
  debug: loadDebugPage,
  tasks: loadTasksPage,
  usage: loadUsagePage,
  webhooks: loadWebhooksPage,
  alerts: loadAlertsPage,
  audit: loadAuditPage,
  settings: loadSettingsPage,
};

function warmPage(page: PageKey) {
  void pagePreloaders[page]().catch(() => undefined);
}

const CachedConsolePage = memo(function CachedConsolePage({
  page,
  active,
  onPage,
  onRegister,
}: {
  page: ConsolePageKey;
  active: boolean;
  onPage: (page: PageKey) => void;
  onRegister: () => void;
}) {
  const openAgents = useCallback(() => onPage("agents"), [onPage]);
  const openTasks = useCallback(() => onPage("tasks"), [onPage]);
  const openAlerts = useCallback(() => onPage("alerts"), [onPage]);
  const content =
    page === "overview" ? (
      <OverviewPage
        openAgents={openAgents}
        openTasks={openTasks}
        openAlerts={openAlerts}
      />
    ) : page === "tenants" ? (
      <TenantsPage />
    ) : page === "members" ? (
      <MembersPage />
    ) : page === "agents" ? (
      <AgentsPage openRegister={onRegister} />
    ) : page === "tasks" ? (
      <TasksPage />
    ) : page === "usage" ? (
      <UsagePage />
    ) : page === "webhooks" ? (
      <WebhooksPage />
    ) : page === "alerts" ? (
      <AlertsPage />
    ) : page === "audit" ? (
      <AuditPage />
    ) : (
      <SettingsPage />
    );

  return (
    <section
      className={shellStyles.pageCachePane}
      data-console-page={page}
      hidden={!active}
      aria-hidden={!active}
    >
      <Suspense fallback={<PageState loading />}>{content}</Suspense>
    </section>
  );
});

const migrateLegacyHashRoute = () => {
  if (location.hash.startsWith("#/")) {
    history.replaceState(history.state, "", location.hash.slice(1));
    return;
  }
  if (location.pathname.length > 1 && location.pathname.endsWith("/"))
    history.replaceState(
      history.state,
      "",
      `${location.pathname.slice(0, -1)}${location.search}`,
    );
};
const pageFromLocation = (): PageKey => {
  migrateLegacyHashRoute();
  const value = location.pathname.replace(/^\/+|\/+$/g, "") as PageKey;
  return [
    "overview",
    "tenants",
    "members",
    "agents",
    "debug",
    "tasks",
    "usage",
    "webhooks",
    "alerts",
    "audit",
    "settings",
  ].includes(value)
    ? value
    : "overview";
};
const invitationTokenFromLocation = () => {
  migrateLegacyHashRoute();
  const match = location.pathname.match(/^\/invite\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : undefined;
};
const oidcCodeFromLocation = () => {
  migrateLegacyHashRoute();
  if (location.pathname.replace(/\/$/, "") !== "/auth/callback")
    return undefined;
  return new URLSearchParams(location.search).get("code") ?? undefined;
};
export default function App() {
  const [token, setToken] = useLocalStorage("a2a-admin-token", "");
  const [selectedTenantId, setSelectedTenantId] = useLocalStorage(
    "a2a-selected-tenant",
    "",
  );
  const [page, setPage] = useState<PageKey>(pageFromLocation);
  const [visitedConsolePages, setVisitedConsolePages] = useState<
    Set<ConsolePageKey>
  >(() =>
    page === "debug"
      ? new Set<ConsolePageKey>()
      : new Set<ConsolePageKey>([page]),
  );
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentPage, setAgentPage] = useState<Page<Agent>>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [user, setUser] = useState<PlatformUser>();
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [realtimeVersion, setRealtimeVersion] = useState(0);
  const agentQuery = useRef({ page: 1, pageSize: 20, search: "", status: "" });
  const refreshAttempted = useRef(false);
  const oidcAttempted = useRef(false);
  const invitationToken = invitationTokenFromLocation();
  const register = useDisclosure();
  const registerActions = useRef({ show: register.show, hide: register.hide });
  registerActions.current = { show: register.show, hide: register.hide };
  const showRegister = useCallback(() => registerActions.current.show(), []);
  const hideRegister = useCallback(() => registerActions.current.hide(), []);
  const refreshTenants = useCallback(async () => {
    if (!token || !user) return { items: [] };
    const items =
      user.platformRole === "platform_admin"
        ? (await platformApi.tenants(token, { page: 1, pageSize: 100 })).items
        : (await platformApi.me(token)).tenants;
    setTenants(items);
    if (selectedTenantId && !items.some((item) => item.id === selectedTenantId))
      setSelectedTenantId("");
    if (!selectedTenantId && user.platformRole !== "platform_admin" && items[0])
      setSelectedTenantId(items[0].id);
    return { items };
  }, [token, user, selectedTenantId, setSelectedTenantId]);
  const refreshAgents = useCallback(
    async (input?: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
    }) => {
      if (!token || !user) return [];
      const requested = input
        ? { ...agentQuery.current, ...input }
        : agentQuery.current;
      agentQuery.current = requested;
      if (user.platformRole === "platform_admin") {
        const result = await platformApi.agents(token, {
          tenantId: selectedTenantId || undefined,
          search: requested.search || undefined,
          status: requested.status || undefined,
        });
        const page = {
          items: result,
          page: 1,
          pageSize: result.length || 20,
          total: result.length,
          totalPages: 1,
        };
        setAgents(result);
        setAgentPage(page);
        return page;
      }
      const result = await platformApi.catalogAgents(token, {
        tenantId: selectedTenantId || undefined,
        page: requested.page,
        pageSize: requested.pageSize,
        search: requested.search || undefined,
        status: requested.status || undefined,
      });
      setAgents(result.items);
      setAgentPage(result);
      return result;
    },
    [token, user, selectedTenantId],
  );
  useEffect(() => {
    const tokenListener = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (next) setToken(next);
    };
    window.addEventListener("a2a-token-refreshed", tokenListener);
    return () =>
      window.removeEventListener("a2a-token-refreshed", tokenListener);
  }, [setToken]);
  useEffect(() => {
    const oidcCode = oidcCodeFromLocation();
    if (!oidcCode || oidcAttempted.current) return;
    oidcAttempted.current = true;
    setAuthReady(false);
    void platformApi
      .oidcExchange(oidcCode)
      .then((result) => {
        setToken(result.accessToken);
        setUser(result.user);
        history.replaceState(null, "", "/overview");
        setPage("overview");
      })
      .catch((reason) =>
        setAuthError(
          reason instanceof Error ? reason.message : "企业身份登录失败。",
        ),
      )
      .finally(() => setAuthReady(true));
  }, [setToken]);
  useEffect(() => {
    if (oidcCodeFromLocation()) return;
    let cancelled = false;
    const authenticate = async () => {
      setAuthError("");
      if (token) {
        try {
          const session = await platformApi.me(token);
          if (!cancelled) {
            setUser(session.user);
            if (session.tenants.length) setTenants(session.tenants);
            setAuthReady(true);
          }
          return;
        } catch {
          // Access token may have expired; the HttpOnly refresh session is authoritative.
        }
      }
      if (!refreshAttempted.current) {
        refreshAttempted.current = true;
        try {
          const refreshed = await platformApi.refreshSession();
          if (!cancelled) {
            setToken(refreshed.accessToken);
            setUser(refreshed.user);
            setAuthReady(true);
          }
          return;
        } catch {
          // An absent refresh cookie is the normal signed-out state.
        }
      }
      if (!cancelled) {
        if (token) setToken("");
        setUser(undefined);
        setAuthReady(true);
      }
    };
    void authenticate();
    return () => {
      cancelled = true;
    };
  }, [token, setToken]);
  useEffect(() => {
    if (user) void refreshTenants().catch(() => setTenants([]));
  }, [refreshTenants]);
  useEffect(() => {
    if (user) {
      agentQuery.current = { page: 1, pageSize: 20, search: "", status: "" };
      void refreshAgents(agentQuery.current).catch(() => setAgents([]));
    }
  }, [refreshAgents]);
  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (!user) return () => controller.abort();
    if (user.platformRole !== "platform_admin" && !selectedTenantId) {
      const interval = window.setInterval(() => void refreshAgents(), 30_000);
      return () => {
        controller.abort();
        window.clearInterval(interval);
      };
    }
    void subscribePlatformEvents(
      token,
      selectedTenantId || undefined,
      () => {
        setRealtimeVersion((value) => value + 1);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refreshAgents(), 250);
      },
      controller.signal,
    ).catch(() => undefined);
    return () => {
      controller.abort();
      clearTimeout(refreshTimer);
    };
  }, [token, user, selectedTenantId, refreshAgents]);
  useEffect(() => {
    const update = () => {
      const next = pageFromLocation();
      warmPage(next);
      setPage(next);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = useCallback((next: PageKey) => {
    warmPage(next);
    const nextPath = `/${next}`;
    if (location.pathname !== nextPath) history.pushState(null, "", nextPath);
    setPage(next);
  }, []);
  const selectedRole = tenants.find(
    (tenant) => tenant.id === selectedTenantId,
  )?.role;
  const canWrite =
    user?.platformRole === "platform_admin" ||
    selectedRole === "tenant_admin" ||
    selectedRole === "developer";
  const canAdminister =
    user?.platformRole === "platform_admin" || selectedRole === "tenant_admin";
  const hasTenantAccess =
    Boolean(selectedTenantId) ||
    (user?.platformRole !== "platform_admin" && tenants.length > 0);
  const effectivePage =
    user?.platformRole !== "platform_admin" && !hasTenantAccess
      ? "agents"
      : user?.platformRole !== "platform_admin" && page === "settings"
        ? "overview"
        : page;
  const cachedPageKeys = useMemo(() => {
    const mounted = new Set(visitedConsolePages);
    if (effectivePage !== "debug") mounted.add(effectivePage);
    return consolePageOrder.filter((key) => mounted.has(key));
  }, [effectivePage, visitedConsolePages]);
  useEffect(() => {
    if (effectivePage === "debug") return;
    setVisitedConsolePages((previous) => {
      if (previous.has(effectivePage)) return previous;
      const next = new Set(previous);
      next.add(effectivePage);
      return next;
    });
  }, [effectivePage]);
  useEffect(() => {
    if (!user || effectivePage === page) return;
    history.replaceState(null, "", `/${effectivePage}`);
    setPage(effectivePage);
  }, [effectivePage, page, user]);
  const onAuthenticated = async (
    accessToken: string,
    acceptInvitation: boolean,
    destination?: "overview" | "agents",
  ) => {
    setToken(accessToken);
    if (acceptInvitation && invitationToken)
      await platformApi.acceptInvitation(invitationToken, accessToken);
    const session = await platformApi.me(accessToken);
    setUser(session.user);
    setTenants(session.tenants);
    if (
      session.user.platformRole !== "platform_admin" &&
      session.tenants.length > 0 &&
      !session.tenants.some((tenant) => tenant.id === selectedTenantId)
    )
      setSelectedTenantId(session.tenants[0].id);
    refreshAttempted.current = true;
    const target =
      destination ?? (session.tenants.length ? "overview" : "agents");
    history.replaceState(null, "", `/${target}`);
    setPage(target);
    setAuthReady(true);
  };
  const logout = useCallback(async () => {
    try {
      await platformApi.logout(token);
    } finally {
      setToken("");
      setUser(undefined);
      setTenants([]);
      setAgents([]);
      setSelectedTenantId("");
      refreshAttempted.current = true;
      history.replaceState(null, "", "/overview");
      setPage("overview");
      setVisitedConsolePages(new Set<ConsolePageKey>(["overview"]));
    }
  }, [setSelectedTenantId, setToken, token]);

  const appContextValue = useMemo<AppContextValue | undefined>(
    () =>
      user
        ? {
            token,
            setToken,
            user,
            selectedRole,
            canWrite,
            canAdminister,
            realtimeVersion,
            logout,
            tenants,
            selectedTenantId,
            setSelectedTenantId,
            agents,
            agentPage,
            refreshTenants,
            refreshAgents,
          }
        : undefined,
    [
      agentPage,
      agents,
      canAdminister,
      canWrite,
      logout,
      realtimeVersion,
      refreshAgents,
      refreshTenants,
      selectedRole,
      selectedTenantId,
      setSelectedTenantId,
      setToken,
      tenants,
      token,
      user,
    ],
  );
  if (!authReady)
    return (
      <div className="appBoot">
        <span />
        正在建立安全会话…
      </div>
    );
  if (!user || !appContextValue)
    return (
      <ToastProvider>
        {authError && <div className="appAuthError">{authError}</div>}
        <AuthPage
          invitationToken={invitationToken}
          onAuthenticated={onAuthenticated}
        />
      </ToastProvider>
    );
  return (
    <ToastProvider>
      <AppContextProvider value={appContextValue}>
        <Layout
          page={effectivePage}
          onPage={navigate}
          onRegister={showRegister}
          onWarmPage={warmPage}
        >
          {cachedPageKeys.map((cachedPage) => (
            <CachedConsolePage
              key={cachedPage}
              page={cachedPage}
              active={effectivePage === cachedPage}
              onPage={navigate}
              onRegister={showRegister}
            />
          ))}
          {effectivePage === "debug" && (
            <Suspense fallback={<PageState loading />}>
              <DebugPage onExitStudio={() => navigate("overview")} />
            </Suspense>
          )}
        </Layout>
        {register.open && (
          <Suspense fallback={null}>
            <RegisterAgentModal
              close={hideRegister}
              saved={async () => {
                hideRegister();
                await refreshAgents();
                navigate("agents");
              }}
            />
          </Suspense>
        )}
      </AppContextProvider>
    </ToastProvider>
  );
}
