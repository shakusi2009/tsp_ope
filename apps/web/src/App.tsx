import { useEffect, useMemo, useState } from 'react';

type BootstrapSummary = {
  databasePath: string;
  migrationsCount: number;
  usersCount: number;
  rolesCount: number;
  permissions: Array<{
    code: string;
    name: string;
  }>;
};

type ServiceState =
  | { status: 'loading' }
  | { status: 'ready'; data: BootstrapSummary }
  | { status: 'error'; message: string };

type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  roleId?: number | null;
  roleKey?: string | null;
  roles?: string[];
  permissions?: string[];
};

type AuthState =
  | { status: 'checking' }
  | { status: 'authenticated'; token: string; user: AuthUser }
  | { status: 'anonymous' };

type DashboardOverview = {
  metrics: {
    registeredVehicles: number;
    onlineVehicles: number;
    alertVehicles: number;
  };
  brandOnlineVehicles: Array<{
    brand: string;
    onlineVehicles: number;
  }>;
  hourlyOnlineVehicles: Array<{
    hour: string;
    onlineVehicles: number;
  }>;
};

type DashboardState =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardOverview }
  | { status: 'error'; message: string };

type UserRecord = {
  id: number;
  username: string;
  displayName: string;
  status: 'active' | 'disabled';
  roleId: number | null;
  roleKey: string | null;
  roleName: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserFormState = {
  username: string;
  displayName: string;
  password: string;
  status: 'active' | 'disabled';
  roleKey: string;
};

type PermissionRecord = {
  id: number;
  code: string;
  name: string;
  description: string | null;
};

type RoleRecord = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

type RoleFormState = {
  code: string;
  name: string;
  description: string;
  permissionCodes: string[];
};

type ViewKey = 'dashboard' | 'account' | 'agent';
type AccountTabKey = 'users' | 'roles';

const navigationItems: Array<{ key: ViewKey; label: string; path: string; permissionCode?: string }> = [
  { key: 'dashboard', label: '平台总览', path: '/' },
  { key: 'account', label: '账号中心', path: '/account', permissionCode: 'account:center' },
  { key: 'agent', label: '智能体中心', path: '/agent', permissionCode: 'agent:center' }
];
const tokenStorageKey = 'tsp_ope_auth_token';
const emptyUserForm: UserFormState = {
  username: '',
  displayName: '',
  password: '',
  status: 'active',
  roleKey: 'super_admin'
};
const emptyRoleForm: RoleFormState = {
  code: '',
  name: '',
  description: '',
  permissionCodes: []
};

function createCaptcha() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

type SubmitEvent = {
  preventDefault: () => void;
};

function hasModuleAccess(user: AuthUser, permissionCode?: string): boolean {
  return !permissionCode || Boolean(user.permissions?.includes(permissionCode));
}

function getViewFromPath(pathname: string): ViewKey {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  return navigationItems.find((item) => item.path === normalizedPath)?.key ?? 'dashboard';
}

function getPathForView(view: ViewKey): string {
  return navigationItems.find((item) => item.key === view)?.path ?? '/';
}

function replaceRoute(view: ViewKey) {
  const nextPath = getPathForView(view);

  if (window.location.pathname !== nextPath) {
    window.history.replaceState({ view }, '', nextPath);
  }
}

export function App() {
  const [serviceState, setServiceState] = useState<ServiceState>({ status: 'loading' });
  const [authState, setAuthState] = useState<AuthState>({ status: 'checking' });
  const [activeView, setActiveView] = useState<ViewKey>(() => getViewFromPath(window.location.pathname));

  useEffect(() => {
    fetch('/api/system/bootstrap')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        return response.json() as Promise<BootstrapSummary>;
      })
      .then((data) => setServiceState({ status: 'ready', data }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '未知错误';
        setServiceState({ status: 'error', message });
      });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(tokenStorageKey);

    if (!token) {
      setAuthState({ status: 'anonymous' });
      return;
    }

    fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('登录状态已失效，请重新登录');
        }

        return response.json() as Promise<{ user: AuthUser }>;
      })
      .then(({ user }) => setAuthState({ status: 'authenticated', token, user }))
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        setAuthState({ status: 'anonymous' });
      });
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(getViewFromPath(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const authenticatedUser = authState.status === 'authenticated' ? authState.user : null;
  const allowedNavigationItems = useMemo(
    () =>
      authenticatedUser
        ? navigationItems.filter((item) => hasModuleAccess(authenticatedUser, item.permissionCode))
        : navigationItems.slice(0, 1),
    [authenticatedUser]
  );

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      return;
    }

    if (!allowedNavigationItems.some((item) => item.key === activeView)) {
      setActiveView('dashboard');
      replaceRoute('dashboard');
      return;
    }

    replaceRoute(activeView);
  }, [activeView, allowedNavigationItems, authState.status]);

  const handleNavigate = (view: ViewKey) => {
    setActiveView(view);

    const nextPath = getPathForView(view);

    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view }, '', nextPath);
    }
  };

  if (authState.status !== 'authenticated') {
    return (
      <LoginPage
        isCheckingSession={authState.status === 'checking'}
        onLogin={(token, user) => {
          localStorage.setItem(tokenStorageKey, token);
          setAuthState({ status: 'authenticated', token, user });
        }}
      />
    );
  }

  const handleLogout = () => {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authState.token}`
      }
    }).finally(() => {
      localStorage.removeItem(tokenStorageKey);
      setAuthState({ status: 'anonymous' });
    });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TSP</span>
          <div>
            <strong>车联网运营</strong>
            <small>本地管理平台</small>
          </div>
        </div>

        <div className="session-card">
          <span>当前账号</span>
          <strong>{authState.user.displayName}</strong>
          <small>{authState.user.username}</small>
        </div>

        <nav aria-label="主导航">
          {allowedNavigationItems.map((item) => (
            <button
              key={item.key}
              className={item.key === activeView ? 'active' : undefined}
              onClick={() => handleNavigate(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="ghost-button" type="button" onClick={handleLogout}>
          退出登录
        </button>
      </aside>

      <section className="content">
        {activeView === 'dashboard' && <DashboardView serviceState={serviceState} token={authState.token} />}
        {activeView === 'account' &&
          (hasModuleAccess(authState.user, 'account:center') ? (
            <AccountCenter token={authState.token} currentUser={authState.user} />
          ) : (
            <NoAccessView />
          ))}
        {activeView === 'agent' &&
          (hasModuleAccess(authState.user, 'agent:center') ? <PlaceholderView /> : <NoAccessView />)}
      </section>
    </main>
  );
}

function DashboardView({ serviceState, token }: { serviceState: ServiceState; token: string }) {
  const [dashboardState, setDashboardState] = useState<DashboardState>({ status: 'loading' });

  useEffect(() => {
    setDashboardState({ status: 'loading' });

    requestJson<DashboardOverview>(token, '/api/dashboard/overview')
      .then((data) => setDashboardState({ status: 'ready', data }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '平台总览加载失败';
        setDashboardState({ status: 'error', message });
      });
  }, [token]);

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">Connected Vehicle Operations</p>
          <h1>车联网运营管理平台</h1>
          <p>集中查看车辆注册规模、实时联网状态、告警车辆和今日在线趋势。</p>
        </div>
        <ServiceBadge state={serviceState} />
      </header>

      {dashboardState.status === 'error' && (
        <section className="panel">
          <p className="error-text">读取平台总览失败：{dashboardState.message}</p>
        </section>
      )}

      <section className="cards metric-cards" aria-label="平台总览指标">
        <MetricCard
          label="注册车辆总数"
          value={dashboardState.status === 'ready' ? dashboardState.data.metrics.registeredVehicles : undefined}
          unit="辆"
        />
        <MetricCard
          label="实时联网车辆总数"
          value={dashboardState.status === 'ready' ? dashboardState.data.metrics.onlineVehicles : undefined}
          unit="辆"
        />
        <MetricCard
          label="告警车辆总数"
          tone="warning"
          value={dashboardState.status === 'ready' ? dashboardState.data.metrics.alertVehicles : undefined}
          unit="辆"
        />
      </section>

      <section className="chart-grid" aria-label="平台总览图表">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Brand Online</p>
              <h2>品牌实时联网车辆数</h2>
            </div>
          </div>
          {dashboardState.status === 'ready' ? (
            <BrandBarChart data={dashboardState.data.brandOnlineVehicles} />
          ) : (
            <p className="muted">正在加载品牌在线数据...</p>
          )}
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Today Trend</p>
              <h2>今日每小时在线车辆总数</h2>
            </div>
          </div>
          {dashboardState.status === 'ready' ? (
            <HourlyLineChart data={dashboardState.data.hourlyOnlineVehicles} />
          ) : (
            <p className="muted">正在加载小时在线趋势...</p>
          )}
        </section>
      </section>

      <section className="panel system-panel">
        <h2>初始化状态</h2>
        <BootstrapDetails state={serviceState} />
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  unit,
  tone = 'normal'
}: {
  label: string;
  value?: number;
  unit: string;
  tone?: 'normal' | 'warning';
}) {
  return (
    <article className={`card metric-card ${tone}`}>
      <span>{label}</span>
      <strong>
        {value === undefined ? '--' : formatNumber(value)}
        <small>{unit}</small>
      </strong>
      <p>{value === undefined ? '正在读取实时数据' : '来自受保护的平台总览接口'}</p>
    </article>
  );
}

function BrandBarChart({ data }: { data: DashboardOverview['brandOnlineVehicles'] }) {
  const maxValue = Math.max(1, ...data.map((item) => item.onlineVehicles));

  return (
    <div className="bar-chart">
      {data.map((item) => (
        <div className="bar-row" key={item.brand}>
          <span className="bar-label">{item.brand}</span>
          <div className="bar-track" aria-hidden="true">
            <span style={{ width: `${(item.onlineVehicles / maxValue) * 100}%` }} />
          </div>
          <strong>{item.onlineVehicles}</strong>
        </div>
      ))}
    </div>
  );
}

function HourlyLineChart({ data }: { data: DashboardOverview['hourlyOnlineVehicles'] }) {
  if (data.length === 0) {
    return <p className="muted">暂无小时在线数据。</p>;
  }

  const width = 680;
  const height = 260;
  const padding = 34;
  const values = data.map((item) => item.onlineVehicles);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data.map((item, index) => {
    const x = padding + index * stepX;
    const y = height - padding - ((item.onlineVehicles - minValue) / range) * (height - padding * 2);

    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${path} L ${padding + (points.length - 1) * stepX} ${height - padding} L ${padding} ${height - padding} Z`;

  return (
    <div className="line-chart">
      <svg aria-label="今日每小时在线车辆总数曲线图" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#58d6ff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#58d6ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const y = padding + tick * ((height - padding * 2) / 3);
          return <line className="grid-line" key={tick} x1={padding} x2={width - padding} y1={y} y2={y} />;
        })}
        <path className="line-area" d={areaPath} />
        <path className="line-path" d={path} />
        {points.map((point, index) => (
          <g key={point.hour}>
            <circle className="line-point" cx={point.x} cy={point.y} r="4" />
            {index % 3 === 0 && (
              <text className="axis-label" textAnchor="middle" x={point.x} y={height - 8}>
                {point.hour.slice(0, 2)}
              </text>
            )}
          </g>
        ))}
        <text className="axis-value" x={padding} y={padding - 10}>
          {formatNumber(maxValue)}
        </text>
        <text className="axis-value" x={padding} y={height - padding + 18}>
          {formatNumber(minValue)}
        </text>
      </svg>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function PlaceholderView() {
  return (
    <section className="panel empty-panel">
      <p className="eyebrow">Agent Center</p>
      <h1>智能体中心</h1>
      <p className="muted">该模块当前仅保留导航入口，具体能力将在后续任务中实现。</p>
    </section>
  );
}

function NoAccessView() {
  return (
    <section className="panel empty-panel">
      <p className="eyebrow">Access Denied</p>
      <h1>暂无访问权限</h1>
      <p className="muted">当前角色未开通该模块权限，请联系管理员调整角色权限后重试。</p>
    </section>
  );
}

async function requestJson<T>(
  token: string,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `请求失败：${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function AccountCenter({ token, currentUser }: { token: string; currentUser: AuthUser }) {
  const [activeTab, setActiveTab] = useState<AccountTabKey>('users');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [form, setForm] = useState<UserFormState>(emptyUserForm);
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [areRolesLoading, setAreRolesLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRoleSaving, setIsRoleSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [roleFeedback, setRoleFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const getPermissionName = (permissionCode: string) =>
    permissions.find((permission) => permission.code === permissionCode)?.name ?? permissionCode;

  const loadUsers = () => {
    setIsLoading(true);
    setFeedback(null);

    const params = new URLSearchParams();

    if (keyword.trim()) {
      params.set('keyword', keyword.trim());
    }

    if (statusFilter) {
      params.set('status', statusFilter);
    }

    requestJson<{ users: UserRecord[] }>(token, `/api/users${params.size > 0 ? `?${params.toString()}` : ''}`)
      .then(({ users }) => setUsers(users))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '用户列表加载失败';
        setFeedback({ type: 'error', message });
      })
      .finally(() => setIsLoading(false));
  };

  const loadRoles = () => {
    setAreRolesLoading(true);
    setRoleFeedback(null);

    requestJson<{ roles: RoleRecord[] }>(token, '/api/roles')
      .then(({ roles }) => setRoles(roles))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '角色列表加载失败';
        setRoleFeedback({ type: 'error', message });
      })
      .finally(() => setAreRolesLoading(false));
  };

  const loadPermissions = () => {
    requestJson<{ permissions: PermissionRecord[] }>(token, '/api/permissions')
      .then(({ permissions }) => setPermissions(permissions))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '权限列表加载失败';
        setRoleFeedback({ type: 'error', message });
      });
  };

  useEffect(() => {
    loadUsers();
    loadRoles();
    loadPermissions();
  }, [token]);

  const resetForm = () => {
    setEditingUserId(null);
    setForm(emptyUserForm);
  };

  const startEdit = (user: UserRecord) => {
    setEditingUserId(user.id);
    setForm({
      username: user.username,
      displayName: user.displayName,
      password: '',
      status: user.status,
      roleKey: user.roleKey ?? ''
    });
    setFeedback(null);
  };

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setRoleForm(emptyRoleForm);
  };

  const startEditRole = (role: RoleRecord) => {
    setEditingRoleId(role.id);
    setRoleForm({
      code: role.code,
      name: role.name,
      description: role.description ?? '',
      permissionCodes: role.permissionCodes
    });
    setRoleFeedback(null);
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      password: form.password,
      status: form.status,
      roleKey: form.roleKey.trim() || undefined
    };
    const isEditing = editingUserId !== null;
    const url = isEditing ? `/api/users/${editingUserId}` : '/api/users';
    const body = isEditing
      ? {
          displayName: payload.displayName,
          password: payload.password || undefined,
          status: payload.status,
          roleKey: payload.roleKey
        }
      : payload;

    requestJson<{ user: UserRecord }>(token, url, {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    })
      .then(() => {
        setFeedback({ type: 'success', message: isEditing ? '用户信息已更新' : '用户已新增' });
        resetForm();
        loadUsers();
        loadRoles();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '保存用户失败';
        setFeedback({ type: 'error', message });
      })
      .finally(() => setIsSaving(false));
  };

  const deleteUser = (user: UserRecord) => {
    if (user.id === currentUser.id || user.username === 'admin') {
      setFeedback({ type: 'error', message: '不能删除当前登录用户或 admin 基础账号' });
      return;
    }

    const confirmed = window.confirm(`确认删除用户「${user.displayName}」吗？`);

    if (!confirmed) {
      return;
    }

    requestJson<never>(token, `/api/users/${user.id}`, { method: 'DELETE' })
      .then(() => {
        setFeedback({ type: 'success', message: '用户已删除' });
        if (editingUserId === user.id) {
          resetForm();
        }
        loadUsers();
        loadRoles();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '删除用户失败';
        setFeedback({ type: 'error', message });
      });
  };

  const toggleRolePermission = (permissionCode: string) => {
    setRoleForm((current) => {
      const hasPermission = current.permissionCodes.includes(permissionCode);

      return {
        ...current,
        permissionCodes: hasPermission
          ? current.permissionCodes.filter((code) => code !== permissionCode)
          : [...current.permissionCodes, permissionCode]
      };
    });
  };

  const handleRoleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setIsRoleSaving(true);
    setRoleFeedback(null);

    const isEditing = editingRoleId !== null;
    const url = isEditing ? `/api/roles/${editingRoleId}` : '/api/roles';

    requestJson<{ role: RoleRecord }>(token, url, {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify({
        code: roleForm.code.trim(),
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        permissionCodes: roleForm.permissionCodes
      })
    })
      .then(() => {
        setRoleFeedback({ type: 'success', message: isEditing ? '角色信息已更新' : '角色已新增' });
        resetRoleForm();
        loadRoles();
        loadUsers();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '保存角色失败';
        setRoleFeedback({ type: 'error', message });
      })
      .finally(() => setIsRoleSaving(false));
  };

  const deleteRole = (role: RoleRecord) => {
    if (role.isSystem) {
      setRoleFeedback({ type: 'error', message: '系统角色不能删除' });
      return;
    }

    if (role.userCount > 0) {
      setRoleFeedback({ type: 'error', message: '角色已关联用户，不能删除' });
      return;
    }

    const confirmed = window.confirm(`确认删除角色「${role.name}」吗？`);

    if (!confirmed) {
      return;
    }

    requestJson<never>(token, `/api/roles/${role.id}`, { method: 'DELETE' })
      .then(() => {
        setRoleFeedback({ type: 'success', message: '角色已删除' });
        if (editingRoleId === role.id) {
          resetRoleForm();
        }
        loadRoles();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '删除角色失败';
        setRoleFeedback({ type: 'error', message });
      });
  };

  return (
    <>
      <header className="hero compact-hero">
        <div>
          <p className="eyebrow">Account Center</p>
          <h1>账号中心</h1>
          <p>管理平台用户、角色和模块访问权限。系统角色拥有全部权限，禁止编辑和删除。</p>
        </div>
        <span className="badge ready">{users.length} 个用户 / {roles.length} 个角色</span>
      </header>

      <div className="tabs" role="tablist" aria-label="账号中心功能">
        <button
          className={activeTab === 'users' ? 'active' : undefined}
          onClick={() => setActiveTab('users')}
          type="button"
        >
          用户管理
        </button>
        <button
          className={activeTab === 'roles' ? 'active' : undefined}
          onClick={() => setActiveTab('roles')}
          type="button"
        >
          角色管理
        </button>
      </div>

      {activeTab === 'users' && (
        <section className="management-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>用户列表</h2>
                <p className="muted">删除操作会保护当前登录用户和 admin 基础账号。</p>
              </div>
              <button className="secondary-button" onClick={loadUsers} type="button">
                刷新
              </button>
            </div>

            <div className="toolbar">
              <input
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索账号或姓名"
                value={keyword}
              />
              <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="">全部状态</option>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
              <button className="secondary-button" onClick={loadUsers} type="button">
                查询
              </button>
            </div>

            {feedback && (
              <p className={`feedback ${feedback.type}`} role="status">
                {feedback.message}
              </p>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>姓名</th>
                    <th>状态</th>
                    <th>角色</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6}>正在加载用户...</td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={6}>暂无匹配用户</td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.username}</strong>
                        </td>
                        <td>{user.displayName}</td>
                        <td>
                          <span className={`status-pill ${user.status}`}>
                            {user.status === 'active' ? '启用' : '停用'}
                          </span>
                        </td>
                        <td>{user.roleName ? `${user.roleName} / ${user.roleKey}` : user.roleKey ?? '-'}</td>
                        <td>{user.updatedAt}</td>
                        <td>
                          <div className="table-actions">
                            <button className="link-button" onClick={() => startEdit(user)} type="button">
                              编辑
                            </button>
                            <button
                              className="danger-button"
                              disabled={user.id === currentUser.id || user.username === 'admin'}
                              onClick={() => deleteUser(user)}
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{editingUserId ? '编辑用户' : '新增用户'}</h2>
                <p className="muted">{editingUserId ? '密码留空表示不修改。' : '新用户密码为必填项。'}</p>
              </div>
              {editingUserId && (
                <button className="secondary-button" onClick={resetForm} type="button">
                  取消编辑
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <label>
                <span>账号</span>
                <input
                  disabled={isSaving || editingUserId !== null}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="例如 ops_user"
                  value={form.username}
                />
              </label>

              <label>
                <span>姓名</span>
                <input
                  disabled={isSaving}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="请输入姓名"
                  value={form.displayName}
                />
              </label>

              <label>
                <span>密码</span>
                <input
                  disabled={isSaving}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder={editingUserId ? '留空则不修改密码' : '请输入初始密码'}
                  type="password"
                  value={form.password}
                />
              </label>

              <label>
                <span>状态</span>
                <select
                  disabled={isSaving}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, status: event.target.value as UserFormState['status'] }))
                  }
                  value={form.status}
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>

              <label>
                <span>角色</span>
                <select
                  disabled={isSaving || areRolesLoading}
                  onChange={(event) => setForm((current) => ({ ...current, roleKey: event.target.value }))}
                  value={form.roleKey}
                >
                  <option value="">不分配角色</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.code}>
                      {role.name} / {role.code}
                    </option>
                  ))}
                </select>
              </label>

              <button className="primary-button" disabled={isSaving} type="submit">
                {isSaving ? '保存中...' : editingUserId ? '保存修改' : '新增用户'}
              </button>
            </form>
          </section>
        </section>
      )}

      {activeTab === 'roles' && (
        <section className="management-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>角色列表</h2>
                <p className="muted">系统角色固定拥有全部模块权限，不能编辑或删除。</p>
              </div>
              <button className="secondary-button" onClick={loadRoles} type="button">
                刷新
              </button>
            </div>

            {roleFeedback && (
              <p className={`feedback ${roleFeedback.type}`} role="status">
                {roleFeedback.message}
              </p>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>角色</th>
                    <th>权限</th>
                    <th>用户数</th>
                    <th>类型</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {areRolesLoading ? (
                    <tr>
                      <td colSpan={5}>正在加载角色...</td>
                    </tr>
                  ) : roles.length === 0 ? (
                    <tr>
                      <td colSpan={5}>暂无角色</td>
                    </tr>
                  ) : (
                    roles.map((role) => (
                      <tr key={role.id}>
                        <td>
                          <strong>{role.name}</strong>
                          <small className="cell-subtitle">{role.code}</small>
                        </td>
                        <td>
                          <div className="permission-tags">
                            {role.permissionCodes.length === 0
                              ? '-'
                              : role.permissionCodes.map((permissionCode) => (
                                  <span key={permissionCode}>{getPermissionName(permissionCode)}</span>
                                ))}
                          </div>
                        </td>
                        <td>{role.userCount}</td>
                        <td>
                          <span className={`status-pill ${role.isSystem ? 'active' : 'disabled'}`}>
                            {role.isSystem ? '系统' : '自定义'}
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="link-button"
                              disabled={role.isSystem}
                              onClick={() => startEditRole(role)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              className="danger-button"
                              disabled={role.isSystem || role.userCount > 0}
                              onClick={() => deleteRole(role)}
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{editingRoleId ? '编辑角色' : '新增角色'}</h2>
                <p className="muted">可配置账号中心和智能体中心访问权限，平台总览默认登录可见。</p>
              </div>
              {editingRoleId && (
                <button className="secondary-button" onClick={resetRoleForm} type="button">
                  取消编辑
                </button>
              )}
            </div>

            <form onSubmit={handleRoleSubmit} noValidate>
              <label>
                <span>角色标识</span>
                <input
                  disabled={isRoleSaving}
                  onChange={(event) => setRoleForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="例如 agent_operator"
                  value={roleForm.code}
                />
              </label>

              <label>
                <span>角色名称</span>
                <input
                  disabled={isRoleSaving}
                  onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="请输入角色名称"
                  value={roleForm.name}
                />
              </label>

              <label>
                <span>角色描述</span>
                <input
                  disabled={isRoleSaving}
                  onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="可选"
                  value={roleForm.description}
                />
              </label>

              <fieldset className="permission-fieldset">
                <legend>模块权限</legend>
                {permissions.map((permission) => (
                  <label className="checkbox-label" key={permission.code}>
                    <input
                      checked={roleForm.permissionCodes.includes(permission.code)}
                      disabled={isRoleSaving || permission.code === 'dashboard:view'}
                      onChange={() => toggleRolePermission(permission.code)}
                      type="checkbox"
                    />
                    <span>{permission.name}</span>
                    <small>{permission.description ?? permission.code}</small>
                  </label>
                ))}
              </fieldset>

              <button className="primary-button" disabled={isRoleSaving} type="submit">
                {isRoleSaving ? '保存中...' : editingRoleId ? '保存修改' : '新增角色'}
              </button>
            </form>
          </section>
        </section>
      )}
    </>
  );
}

function LoginPage({
  isCheckingSession,
  onLogin
}: {
  isCheckingSession: boolean;
  onLogin: (token: string, user: AuthUser) => void;
}) {
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const platformStats = useMemo(
    () => [
      ['车辆在线监控', '实时'],
      ['运营权限体系', '内置'],
      ['SQLite 会话', '启用']
    ],
    []
  );

  const refreshCaptcha = () => {
    setCaptcha(createCaptcha());
    setCaptchaInput('');
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setErrorMessage('');

    if (!username.trim()) {
      setErrorMessage('账号错误，请重新输入');
      return;
    }

    if (!password) {
      setErrorMessage('密码错误，请重新输入');
      return;
    }

    if (captchaInput.trim() !== captcha) {
      setErrorMessage('验证码错误，请重新输入');
      refreshCaptcha();
      return;
    }

    setIsSubmitting(true);

    fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: username.trim(),
        password
      })
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((body: { error?: string }) => {
            throw new Error(body.error ?? '账号或密码错误，请重新输入');
          });
        }

        return response.json() as Promise<{ token: string; user: AuthUser }>;
      })
      .then(({ token, user }) => onLogin(token, user))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '账号或密码错误，请重新输入';
        setErrorMessage(message);
        refreshCaptcha();
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <main className="login-shell">
      <section className="login-visual" aria-label="平台说明">
        <div className="brand login-brand">
          <span className="brand-mark">TSP</span>
          <div>
            <strong>车联网运营管理平台</strong>
            <small>Connected Vehicle Operations</small>
          </div>
        </div>

        <div className="vehicle-panel">
          <p className="eyebrow">Operations Console</p>
          <h1>面向车辆运营、账号权限与智能体管理的控制台</h1>
          <p>聚焦后台管理场景，提供稳定的身份入口和后续模块鉴权基础。</p>
          <div className="road-line" aria-hidden="true" />
        </div>

        <div className="stat-strip">
          {platformStats.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="login-card" aria-label="账号登录">
        <div>
          <p className="eyebrow">Secure Sign In</p>
          <h2>平台登录</h2>
          <p className="muted">使用超级管理员账号进入本地运营平台。</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label>
            <span>账号</span>
            <input
              autoComplete="username"
              disabled={isCheckingSession || isSubmitting}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入账号"
              value={username}
            />
          </label>

          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              disabled={isCheckingSession || isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>

          <label>
            <span>验证码</span>
            <div className="captcha-row">
              <input
                autoComplete="off"
                disabled={isCheckingSession || isSubmitting}
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setCaptchaInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 位验证码"
                value={captchaInput}
              />
              <button
                aria-label="刷新验证码"
                className="captcha-code"
                disabled={isCheckingSession || isSubmitting}
                onClick={refreshCaptcha}
                type="button"
              >
                {captcha}
              </button>
            </div>
          </label>

          {errorMessage && (
            <p className="login-error" role="alert">
              {errorMessage}
            </p>
          )}

          <button className="primary-button" disabled={isCheckingSession || isSubmitting} type="submit">
            {isCheckingSession ? '校验会话中...' : isSubmitting ? '登录中...' : '登录平台'}
          </button>
        </form>

        <p className="login-hint">初始超级管理员：admin / Test1234!</p>
      </section>
    </main>
  );
}

function ServiceBadge({ state }: { state: ServiceState }) {
  if (state.status === 'loading') {
    return <span className="badge pending">连接中</span>;
  }

  if (state.status === 'error') {
    return <span className="badge error">API 异常</span>;
  }

  return <span className="badge ready">API 正常</span>;
}

function BootstrapDetails({ state }: { state: ServiceState }) {
  if (state.status === 'loading') {
    return <p className="muted">正在读取本地服务初始化信息...</p>;
  }

  if (state.status === 'error') {
    return <p className="error-text">读取失败：{state.message}</p>;
  }

  return (
    <dl className="details">
      <div>
        <dt>数据库文件</dt>
        <dd>{state.data.databasePath}</dd>
      </div>
      <div>
        <dt>迁移数</dt>
        <dd>{state.data.migrationsCount}</dd>
      </div>
      <div>
        <dt>基础账号数</dt>
        <dd>{state.data.usersCount}</dd>
      </div>
      <div>
        <dt>基础角色数</dt>
        <dd>{state.data.rolesCount}</dd>
      </div>
      <div>
        <dt>模块权限</dt>
        <dd>{state.data.permissions.map((permission) => permission.name).join(' / ')}</dd>
      </div>
    </dl>
  );
}
