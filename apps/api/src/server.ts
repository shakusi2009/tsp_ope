import { randomBytes } from 'node:crypto';
import cors from 'cors';
import express, { type Request } from 'express';
import {
  getBootstrapSummary,
  getDatabasePath,
  getPlatformOverview,
  hashPassword,
  openDatabase,
  runMigrations,
  verifyPassword
} from './database.js';

const port = Number(process.env.API_PORT ?? 3001);
const app = express();
const sessionTtlMs = 1000 * 60 * 60 * 8;

runMigrations();

app.use(cors({ allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

type LoginRequestBody = {
  username?: unknown;
  password?: unknown;
};

type AuthenticatedUser = {
  id: number;
  username: string;
  displayName: string;
  roleId: number | null;
  roleKey: string | null;
  roles: string[];
  permissions: string[];
};

type UserRecord = {
  id: number;
  username: string;
  displayName: string;
  status: string;
  roleId: number | null;
  roleKey: string | null;
  roleName: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateUserRequestBody = {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  status?: unknown;
  roleId?: unknown;
  roleKey?: unknown;
};

type UpdateUserRequestBody = Partial<CreateUserRequestBody>;

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

type CreateRoleRequestBody = {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  permissionCodes?: unknown;
};

type UpdateRoleRequestBody = Partial<CreateRoleRequestBody>;

const protectedRoleCodes = new Set(['super_admin', 'admin']);

function getBearerToken(request: Request): string | null {
  const authorization = request.header('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

function getAuthenticatedUser(request: Request): AuthenticatedUser | null {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  const db = openDatabase();

  try {
    const user = db
      .prepare(
        `
          SELECT users.id, users.username, users.display_name AS displayName
          FROM auth_sessions
          JOIN users ON users.id = auth_sessions.user_id
          WHERE auth_sessions.token = ?
            AND auth_sessions.expires_at > CURRENT_TIMESTAMP
            AND users.status = 'active'
          LIMIT 1
        `
      )
      .get(token) as Pick<AuthenticatedUser, 'id' | 'username' | 'displayName'> | undefined;

    if (!user) {
      return null;
    }

    const roles = db
      .prepare(
        `
          SELECT roles.code
          FROM user_roles
          JOIN roles ON roles.id = user_roles.role_id
          WHERE user_roles.user_id = ?
          ORDER BY roles.id
        `
      )
      .all(user.id) as Array<{ code: string }>;

    const primaryRole = db
      .prepare(
        `
          SELECT roles.id AS roleId, roles.code AS roleKey
          FROM user_roles
          JOIN roles ON roles.id = user_roles.role_id
          WHERE user_roles.user_id = ?
          ORDER BY roles.id
          LIMIT 1
        `
      )
      .get(user.id) as { roleId: number; roleKey: string } | undefined;

    return {
      ...user,
      roleId: primaryRole?.roleId ?? null,
      roleKey: primaryRole?.roleKey ?? null,
      roles: roles.map((role) => role.code),
      permissions: getUserPermissionCodes(db, user.id)
    };
  } finally {
    db.close();
  }
}

function getUserPermissionCodes(db: ReturnType<typeof openDatabase>, userId: number): string[] {
  const permissions = db
    .prepare(
      `
        SELECT DISTINCT permissions.code
        FROM user_roles
        JOIN role_permissions ON role_permissions.role_id = user_roles.role_id
        JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE user_roles.user_id = ?
        ORDER BY permissions.id
      `
    )
    .all(userId) as Array<{ code: string }>;

  return permissions.map((permission) => permission.code);
}

function getUserAccessById(db: ReturnType<typeof openDatabase>, userId: number): AuthenticatedUser | null {
  const user = db
    .prepare(
      `
        SELECT id, username, display_name AS displayName
        FROM users
        WHERE id = ?
          AND status = 'active'
        LIMIT 1
      `
    )
    .get(userId) as Pick<AuthenticatedUser, 'id' | 'username' | 'displayName'> | undefined;

  if (!user) {
    return null;
  }

  const roles = db
    .prepare(
      `
        SELECT roles.code
        FROM user_roles
        JOIN roles ON roles.id = user_roles.role_id
        WHERE user_roles.user_id = ?
        ORDER BY roles.id
      `
    )
    .all(user.id) as Array<{ code: string }>;

  const primaryRole = db
    .prepare(
      `
        SELECT roles.id AS roleId, roles.code AS roleKey
        FROM user_roles
        JOIN roles ON roles.id = user_roles.role_id
        WHERE user_roles.user_id = ?
        ORDER BY roles.id
        LIMIT 1
      `
    )
    .get(user.id) as { roleId: number; roleKey: string } | undefined;

  return {
    ...user,
    roleId: primaryRole?.roleId ?? null,
    roleKey: primaryRole?.roleKey ?? null,
    roles: roles.map((role) => role.code),
    permissions: getUserPermissionCodes(db, user.id)
  };
}

function requireAuth(
  request: Request,
  response: express.Response,
  next: express.NextFunction
): void {
  const user = getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({
      error: '登录状态已失效，请重新登录'
    });
    return;
  }

  (request as AuthenticatedRequest).user = user;
  next();
}

function requirePermission(permissionCode: string) {
  return (request: Request, response: express.Response, next: express.NextFunction): void => {
    const user = (request as AuthenticatedRequest).user;

    if (!user.permissions.includes(permissionCode)) {
      response.status(403).json({
        error: '当前角色无权访问该模块'
      });
      return;
    }

    next();
  };
}

function readRequiredText(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName}不能为空`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error(`${fieldName}不能为空`);
  }

  if (normalizedValue.length > maxLength) {
    throw new Error(`${fieldName}不能超过 ${maxLength} 个字符`);
  }

  return normalizedValue;
}

function readOptionalText(value: unknown, fieldName: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return readRequiredText(value, fieldName, maxLength);
}

function readStatus(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'active';
  }

  if (value !== 'active' && value !== 'disabled') {
    throw new Error('用户状态仅支持 active 或 disabled');
  }

  return value;
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName}格式不正确`);
  }

  return value;
}

function readRoleCode(value: unknown): string {
  const code = readRequiredText(value, '角色标识', 64);

  if (!/^[A-Za-z0-9_.:-]+$/.test(code)) {
    throw new Error('角色标识仅支持字母、数字、下划线、中划线、点和冒号');
  }

  return code;
}

function readPermissionCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('角色权限配置格式不正确');
  }

  const codes = value.map((permissionCode) => readRequiredText(permissionCode, '权限标识', 64));

  return Array.from(new Set(codes));
}

function getRolePermissions(db: ReturnType<typeof openDatabase>, roleId: number): string[] {
  const permissions = db
    .prepare(
      `
        SELECT permissions.code
        FROM role_permissions
        JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE role_permissions.role_id = ?
        ORDER BY permissions.id
      `
    )
    .all(roleId) as Array<{ code: string }>;

  return permissions.map((permission) => permission.code);
}

function getRoleById(db: ReturnType<typeof openDatabase>, roleId: number): RoleRecord | null {
  const role = db
    .prepare(
      `
        SELECT
          roles.id,
          roles.code,
          roles.name,
          roles.description,
          roles.is_system AS isSystem,
          COUNT(user_roles.user_id) AS userCount,
          roles.created_at AS createdAt,
          roles.updated_at AS updatedAt
        FROM roles
        LEFT JOIN user_roles ON user_roles.role_id = roles.id
        WHERE roles.id = ?
        GROUP BY roles.id
        LIMIT 1
      `
    )
    .get(roleId) as Omit<RoleRecord, 'isSystem' | 'permissionCodes'> & { isSystem: number } | undefined;

  if (!role) {
    return null;
  }

  return {
    ...role,
    isSystem: Boolean(role.isSystem),
    permissionCodes: getRolePermissions(db, role.id)
  };
}

function assignRolePermissions(
  db: ReturnType<typeof openDatabase>,
  roleId: number,
  permissionCodes: string[]
): void {
  const permissions = db.prepare('SELECT id, code FROM permissions ORDER BY id').all() as Array<{
    id: number;
    code: string;
  }>;
  const permissionIdByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));
  const invalidPermissionCode = permissionCodes.find((permissionCode) => !permissionIdByCode.has(permissionCode));

  if (invalidPermissionCode) {
    throw new Error(`权限不存在：${invalidPermissionCode}`);
  }

  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);

  const insertPermission = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const permissionCode of permissionCodes) {
    const permissionId = permissionIdByCode.get(permissionCode);

    if (!permissionId) {
      throw new Error(`权限不存在：${permissionCode}`);
    }

    insertPermission.run(roleId, permissionId);
  }
}

function ensureSystemRolePermissions(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT roles.id, permissions.id
    FROM roles
    CROSS JOIN permissions
    WHERE roles.code IN ('super_admin', 'admin');
  `);
}

function resolveRoleId(db: ReturnType<typeof openDatabase>, roleId: unknown, roleKey: unknown): number | null {
  const normalizedRoleId = readOptionalPositiveInteger(roleId, '角色ID');
  const normalizedRoleKey = readOptionalText(roleKey, '角色标识', 64);

  if (normalizedRoleId === undefined && normalizedRoleKey === undefined) {
    return null;
  }

  const role =
    normalizedRoleId !== undefined
      ? (db.prepare('SELECT id FROM roles WHERE id = ? LIMIT 1').get(normalizedRoleId) as { id: number } | undefined)
      : (db.prepare('SELECT id FROM roles WHERE code = ? LIMIT 1').get(normalizedRoleKey ?? '') as
          | { id: number }
          | undefined);

  if (!role) {
    throw new Error('指定角色不存在');
  }

  return role.id;
}

function assignPrimaryRole(db: ReturnType<typeof openDatabase>, userId: number, roleId: number | null): void {
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);

  if (roleId) {
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  }
}

function mapUserRow(row: UserRecord): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    status: row.status,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function getUserById(db: ReturnType<typeof openDatabase>, userId: number): UserRecord | null {
  const user = db
    .prepare(
      `
        SELECT
          users.id,
          users.username,
          users.display_name AS displayName,
          users.status,
          roles.id AS roleId,
          roles.code AS roleKey,
          roles.name AS roleName,
          users.created_at AS createdAt,
          users.updated_at AS updatedAt
        FROM users
        LEFT JOIN user_roles ON user_roles.user_id = users.id
        LEFT JOIN roles ON roles.id = user_roles.role_id
        WHERE users.id = ?
        ORDER BY roles.id
        LIMIT 1
      `
    )
    .get(userId) as UserRecord | undefined;

  return user ? mapUserRow(user) : null;
}

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'tsp-ope-api'
  });
});

app.get('/api/system/bootstrap', (_request, response) => {
  response.json(getBootstrapSummary());
});

app.post('/api/auth/login', (request, response) => {
  const { username, password } = request.body as LoginRequestBody;

  if (typeof username !== 'string' || typeof password !== 'string') {
    response.status(400).json({
      error: '请输入账号和密码后重试'
    });
    return;
  }

  const normalizedUsername = username.trim();
  const db = openDatabase();

  try {
    const user = db
      .prepare(
        `
          SELECT id, username, password_hash AS passwordHash, display_name AS displayName, status
          FROM users
          WHERE username = ?
          LIMIT 1
        `
      )
      .get(normalizedUsername) as
      | {
          id: number;
          username: string;
          passwordHash: string;
          displayName: string;
          status: string;
        }
      | undefined;

    if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
      response.status(401).json({
        error: '账号或密码错误，请重新输入'
      });
      return;
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString().slice(0, 19).replace('T', ' ');

    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
    db.prepare('INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(
      user.id,
      token,
      expiresAt
    );

    const authenticatedUser = getUserAccessById(db, user.id);

    if (!authenticatedUser) {
      response.status(401).json({
        error: '账号或密码错误，请重新输入'
      });
      return;
    }

    response.json({
      token,
      expiresAt,
      user: authenticatedUser
    });
  } finally {
    db.close();
  }
});

app.get('/api/auth/me', (request, response) => {
  const user = getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({
      error: '登录状态已失效，请重新登录'
    });
    return;
  }

  response.json({ user });
});

app.get('/api/dashboard/overview', requireAuth, (_request, response) => {
  response.json(getPlatformOverview());
});

app.post('/api/auth/logout', (request, response) => {
  const token = getBearerToken(request);

  if (token) {
    const db = openDatabase();

    try {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    } finally {
      db.close();
    }
  }

  response.status(204).send();
});

app.get('/api/permissions', requireAuth, requirePermission('account:center'), (_request, response) => {
  const db = openDatabase();

  try {
    const permissions = db
      .prepare('SELECT id, code, name, description FROM permissions ORDER BY id')
      .all() as PermissionRecord[];

    response.json({ permissions });
  } finally {
    db.close();
  }
});

app.get('/api/roles', requireAuth, requirePermission('account:center'), (_request, response) => {
  const db = openDatabase();

  try {
    ensureSystemRolePermissions(db);

    const roleRows = db
      .prepare(
        `
          SELECT
            roles.id,
            roles.code,
            roles.name,
            roles.description,
            roles.is_system AS isSystem,
            COUNT(user_roles.user_id) AS userCount,
            roles.created_at AS createdAt,
            roles.updated_at AS updatedAt
          FROM roles
          LEFT JOIN user_roles ON user_roles.role_id = roles.id
          GROUP BY roles.id
          ORDER BY roles.is_system DESC, roles.id
        `
      )
      .all() as Array<Omit<RoleRecord, 'isSystem' | 'permissionCodes'> & { isSystem: number }>;

    const roles = roleRows.map((role) => ({
      ...role,
      isSystem: Boolean(role.isSystem),
      permissionCodes: getRolePermissions(db, role.id)
    }));

    response.json({ roles });
  } finally {
    db.close();
  }
});

app.get('/api/roles/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const roleId = Number(request.params.id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    response.status(400).json({ error: '角色ID格式不正确' });
    return;
  }

  const db = openDatabase();

  try {
    ensureSystemRolePermissions(db);

    const role = getRoleById(db, roleId);

    if (!role) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    response.json({ role });
  } finally {
    db.close();
  }
});

app.post('/api/roles', requireAuth, requirePermission('account:center'), (request, response) => {
  const body = request.body as CreateRoleRequestBody;
  const db = openDatabase();

  try {
    const code = readRoleCode(body.code);
    const name = readRequiredText(body.name, '角色名称', 80);
    const description = readOptionalText(body.description, '角色描述', 200) ?? null;
    const permissionCodes = readPermissionCodes(body.permissionCodes);

    db.exec('BEGIN;');
    try {
      const result = db
        .prepare(
          `
            INSERT INTO roles (code, name, description, is_system)
            VALUES (?, ?, ?, 0)
          `
        )
        .run(code, name, description);

      const roleId = Number(result.lastInsertRowid);
      assignRolePermissions(db, roleId, permissionCodes);
      ensureSystemRolePermissions(db);
      db.exec('COMMIT;');

      response.status(201).json({ role: getRoleById(db, roleId) });
    } catch (error) {
      db.exec('ROLLBACK;');

      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: roles.code')) {
        response.status(409).json({ error: '角色标识已存在，请更换后重试' });
        return;
      }

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '新增角色失败';
    response.status(400).json({ error: message });
  } finally {
    db.close();
  }
});

app.put('/api/roles/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const roleId = Number(request.params.id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    response.status(400).json({ error: '角色ID格式不正确' });
    return;
  }

  const body = request.body as UpdateRoleRequestBody;
  const db = openDatabase();

  try {
    const existingRole = getRoleById(db, roleId);

    if (!existingRole) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    if (existingRole.isSystem || protectedRoleCodes.has(existingRole.code)) {
      ensureSystemRolePermissions(db);
      response.status(400).json({ error: '系统角色不能编辑或移除权限' });
      return;
    }

    const code = body.code === undefined ? existingRole.code : readRoleCode(body.code);
    const name = body.name === undefined ? existingRole.name : readRequiredText(body.name, '角色名称', 80);
    const description =
      body.description === undefined ? existingRole.description : readOptionalText(body.description, '角色描述', 200) ?? null;
    const permissionCodes =
      body.permissionCodes === undefined ? existingRole.permissionCodes : readPermissionCodes(body.permissionCodes);

    db.exec('BEGIN;');
    try {
      db.prepare(
        `
          UPDATE roles
          SET code = ?, name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(code, name, description, roleId);

      assignRolePermissions(db, roleId, permissionCodes);
      ensureSystemRolePermissions(db);
      db.exec('COMMIT;');

      response.json({ role: getRoleById(db, roleId) });
    } catch (error) {
      db.exec('ROLLBACK;');

      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: roles.code')) {
        response.status(409).json({ error: '角色标识已存在，请更换后重试' });
        return;
      }

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '编辑角色失败';
    response.status(400).json({ error: message });
  } finally {
    db.close();
  }
});

app.delete('/api/roles/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const roleId = Number(request.params.id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    response.status(400).json({ error: '角色ID格式不正确' });
    return;
  }

  const db = openDatabase();

  try {
    const existingRole = getRoleById(db, roleId);

    if (!existingRole) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    if (existingRole.isSystem || protectedRoleCodes.has(existingRole.code)) {
      ensureSystemRolePermissions(db);
      response.status(400).json({ error: '系统角色不能删除' });
      return;
    }

    if (existingRole.userCount > 0) {
      response.status(400).json({ error: '角色已关联用户，不能删除' });
      return;
    }

    db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
    ensureSystemRolePermissions(db);
    response.status(204).send();
  } finally {
    db.close();
  }
});

app.get('/api/users', requireAuth, requirePermission('account:center'), (request, response) => {
  const keyword = typeof request.query.keyword === 'string' ? request.query.keyword.trim() : '';
  const status = typeof request.query.status === 'string' ? request.query.status.trim() : '';
  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (keyword) {
    filters.push('(users.username LIKE ? OR users.display_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (status) {
    if (status !== 'active' && status !== 'disabled') {
      response.status(400).json({ error: '用户状态仅支持 active 或 disabled' });
      return;
    }

    filters.push('users.status = ?');
    params.push(status);
  }

  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const db = openDatabase();

  try {
    const users = db
      .prepare(
        `
          SELECT
            users.id,
            users.username,
            users.display_name AS displayName,
            users.status,
            roles.id AS roleId,
            roles.code AS roleKey,
            roles.name AS roleName,
            users.created_at AS createdAt,
            users.updated_at AS updatedAt
          FROM users
          LEFT JOIN user_roles ON user_roles.user_id = users.id
          LEFT JOIN roles ON roles.id = user_roles.role_id
          ${whereSql}
          GROUP BY users.id
          ORDER BY users.id
        `
      )
      .all(...params) as UserRecord[];

    response.json({ users: users.map(mapUserRow) });
  } finally {
    db.close();
  }
});

app.get('/api/users/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const userId = Number(request.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    response.status(400).json({ error: '用户ID格式不正确' });
    return;
  }

  const db = openDatabase();

  try {
    const user = getUserById(db, userId);

    if (!user) {
      response.status(404).json({ error: '用户不存在' });
      return;
    }

    response.json({ user });
  } finally {
    db.close();
  }
});

app.post('/api/users', requireAuth, requirePermission('account:center'), (request, response) => {
  const body = request.body as CreateUserRequestBody;
  const db = openDatabase();

  try {
    const username = readRequiredText(body.username, '账号', 64);
    const password = readRequiredText(body.password, '密码', 128);
    const displayName = readRequiredText(body.displayName, '姓名', 80);
    const status = readStatus(body.status);
    const roleId = resolveRoleId(db, body.roleId, body.roleKey);

    if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
      response.status(400).json({ error: '账号仅支持字母、数字、下划线、中划线和点' });
      return;
    }

    db.exec('BEGIN;');
    try {
      const result = db
        .prepare(
          `
            INSERT INTO users (username, password_hash, display_name, status)
            VALUES (?, ?, ?, ?)
          `
        )
        .run(username, hashPassword(password), displayName, status);

      const userId = Number(result.lastInsertRowid);
      assignPrimaryRole(db, userId, roleId);
      db.exec('COMMIT;');

      response.status(201).json({ user: getUserById(db, userId) });
    } catch (error) {
      db.exec('ROLLBACK;');

      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.username')) {
        response.status(409).json({ error: '账号已存在，请更换后重试' });
        return;
      }

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '新增用户失败';
    response.status(400).json({ error: message });
  } finally {
    db.close();
  }
});

app.put('/api/users/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const userId = Number(request.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    response.status(400).json({ error: '用户ID格式不正确' });
    return;
  }

  const body = request.body as UpdateUserRequestBody;
  const db = openDatabase();

  try {
    const existingUser = getUserById(db, userId);

    if (!existingUser) {
      response.status(404).json({ error: '用户不存在' });
      return;
    }

    const displayName = readOptionalText(body.displayName, '姓名', 80) ?? existingUser.displayName;
    const password = readOptionalText(body.password, '密码', 128);
    const requestedStatus = body.status === undefined ? existingUser.status : readStatus(body.status);
    const authenticatedUser = (request as AuthenticatedRequest).user;

    if (existingUser.username === 'admin' && requestedStatus !== 'active') {
      response.status(400).json({ error: 'admin 基础账号不能禁用' });
      return;
    }

    if (authenticatedUser.id === userId && requestedStatus !== 'active') {
      response.status(400).json({ error: '不能禁用当前登录用户' });
      return;
    }

    const hasRoleUpdate = body.roleId !== undefined || body.roleKey !== undefined;
    const roleId = hasRoleUpdate ? resolveRoleId(db, body.roleId, body.roleKey) : existingUser.roleId;

    if (existingUser.username === 'admin' && roleId) {
      const targetRole = db.prepare('SELECT code FROM roles WHERE id = ? LIMIT 1').get(roleId) as
        | { code: string }
        | undefined;

      if (!targetRole || !protectedRoleCodes.has(targetRole.code)) {
        response.status(400).json({ error: 'admin 基础账号必须保留系统角色' });
        return;
      }
    }

    db.exec('BEGIN;');
    try {
      if (password) {
        db.prepare(
          `
            UPDATE users
            SET display_name = ?, status = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        ).run(displayName, requestedStatus, hashPassword(password), userId);
      } else {
        db.prepare(
          `
            UPDATE users
            SET display_name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        ).run(displayName, requestedStatus, userId);
      }

      assignPrimaryRole(db, userId, roleId);
      db.exec('COMMIT;');

      response.json({ user: getUserById(db, userId) });
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '编辑用户失败';
    response.status(400).json({ error: message });
  } finally {
    db.close();
  }
});

app.delete('/api/users/:id', requireAuth, requirePermission('account:center'), (request, response) => {
  const userId = Number(request.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    response.status(400).json({ error: '用户ID格式不正确' });
    return;
  }

  const authenticatedUser = (request as AuthenticatedRequest).user;

  if (authenticatedUser.id === userId) {
    response.status(400).json({ error: '不能删除当前登录用户' });
    return;
  }

  const db = openDatabase();

  try {
    const existingUser = getUserById(db, userId);

    if (!existingUser) {
      response.status(404).json({ error: '用户不存在' });
      return;
    }

    if (existingUser.username === 'admin') {
      response.status(400).json({ error: 'admin 基础账号不能删除' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    response.status(204).send();
  } finally {
    db.close();
  }
});

app.use((_request, response) => {
  response.status(404).json({
    error: 'Not Found'
  });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`SQLite database: ${getDatabasePath()}`);
});
