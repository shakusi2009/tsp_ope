import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type MigrationResult = {
  databasePath: string;
  appliedMigrations: string[];
};

export type PlatformOverview = {
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

type Migration = {
  id: string;
  up: (db: DatabaseSync) => void;
};

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const defaultDatabasePath = resolve(projectRoot, 'data', 'tsp_ope.sqlite');

const migrations: Migration[] = [
  {
    id: '001_initial_identity_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE role_permissions (
          role_id INTEGER NOT NULL,
          permission_id INTEGER NOT NULL,
          PRIMARY KEY (role_id, permission_id),
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
          FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
        );

        CREATE TABLE user_roles (
          user_id INTEGER NOT NULL,
          role_id INTEGER NOT NULL,
          PRIMARY KEY (user_id, role_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    id: '002_seed_platform_basics',
    up: (db) => {
      const passwordHash = hashPassword('Test1234!');

      db.prepare(`
        INSERT OR IGNORE INTO permissions (code, name, description)
        VALUES
          ('dashboard:view', '平台总览', '访问车联网运营平台总览'),
          ('account:center', '账号中心', '访问用户、角色与权限管理'),
          ('agent:center', '智能体中心', '访问智能体中心预留入口')
      `).run();

      db.prepare(`
        INSERT OR IGNORE INTO roles (code, name, description, is_system)
        VALUES ('super_admin', '超级管理员', '拥有全部系统功能模块访问权限', 1)
      `).run();

      db.prepare(`
        INSERT OR IGNORE INTO users (username, password_hash, display_name, status)
        VALUES ('admin', ?, '超级管理员', 'active')
      `).run(passwordHash);

      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
        SELECT roles.id, permissions.id
        FROM roles
        CROSS JOIN permissions
        WHERE roles.code = 'super_admin';

        INSERT OR IGNORE INTO user_roles (user_id, role_id)
        SELECT users.id, roles.id
        FROM users
        CROSS JOIN roles
        WHERE users.username = 'admin'
          AND roles.code = 'super_admin';
      `);
    }
  },
  {
    id: '003_auth_sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE auth_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_auth_sessions_token ON auth_sessions(token);
        CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
      `);
    }
  },
  {
    id: '004_seed_platform_overview',
    up: (db) => {
      db.exec(`
        CREATE TABLE vehicle_brands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          display_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE vehicles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vin TEXT NOT NULL UNIQUE,
          brand_id INTEGER NOT NULL,
          plate_no TEXT NOT NULL,
          connection_status TEXT NOT NULL CHECK (connection_status IN ('online', 'offline')),
          alert_status TEXT NOT NULL CHECK (alert_status IN ('normal', 'active')),
          registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (brand_id) REFERENCES vehicle_brands(id) ON DELETE RESTRICT
        );

        CREATE TABLE hourly_online_vehicle_counts (
          hour INTEGER PRIMARY KEY CHECK (hour BETWEEN 0 AND 23),
          online_count INTEGER NOT NULL CHECK (online_count >= 0),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_vehicles_brand_id ON vehicles(brand_id);
        CREATE INDEX idx_vehicles_connection_status ON vehicles(connection_status);
        CREATE INDEX idx_vehicles_alert_status ON vehicles(alert_status);

        INSERT INTO vehicle_brands (name, display_order)
        VALUES
          ('岚图汽车', 1),
          ('猛士科技', 2),
          ('东风风神', 3),
          ('东风奕派', 4),
          ('东风纳米', 5);

        INSERT INTO vehicles (vin, brand_id, plate_no, connection_status, alert_status)
        SELECT 'LVOVERVIEW001', id, '京A-T001', 'online', 'normal' FROM vehicle_brands WHERE name = '岚图汽车'
        UNION ALL SELECT 'LVOVERVIEW002', id, '京A-T002', 'online', 'active' FROM vehicle_brands WHERE name = '岚图汽车'
        UNION ALL SELECT 'LVOVERVIEW003', id, '京A-T003', 'online', 'normal' FROM vehicle_brands WHERE name = '岚图汽车'
        UNION ALL SELECT 'LVOVERVIEW004', id, '京A-T004', 'offline', 'normal' FROM vehicle_brands WHERE name = '岚图汽车'
        UNION ALL SELECT 'LVOVERVIEW005', id, '沪B-M001', 'online', 'normal' FROM vehicle_brands WHERE name = '猛士科技'
        UNION ALL SELECT 'LVOVERVIEW006', id, '沪B-M002', 'online', 'normal' FROM vehicle_brands WHERE name = '猛士科技'
        UNION ALL SELECT 'LVOVERVIEW007', id, '沪B-M003', 'offline', 'active' FROM vehicle_brands WHERE name = '猛士科技'
        UNION ALL SELECT 'LVOVERVIEW008', id, '粤C-F001', 'online', 'normal' FROM vehicle_brands WHERE name = '东风风神'
        UNION ALL SELECT 'LVOVERVIEW009', id, '粤C-F002', 'online', 'normal' FROM vehicle_brands WHERE name = '东风风神'
        UNION ALL SELECT 'LVOVERVIEW010', id, '粤C-F003', 'online', 'active' FROM vehicle_brands WHERE name = '东风风神'
        UNION ALL SELECT 'LVOVERVIEW011', id, '粤C-F004', 'offline', 'normal' FROM vehicle_brands WHERE name = '东风风神'
        UNION ALL SELECT 'LVOVERVIEW012', id, '浙D-E001', 'online', 'normal' FROM vehicle_brands WHERE name = '东风奕派'
        UNION ALL SELECT 'LVOVERVIEW013', id, '浙D-E002', 'offline', 'normal' FROM vehicle_brands WHERE name = '东风奕派'
        UNION ALL SELECT 'LVOVERVIEW014', id, '苏E-N001', 'online', 'active' FROM vehicle_brands WHERE name = '东风纳米'
        UNION ALL SELECT 'LVOVERVIEW015', id, '苏E-N002', 'online', 'normal' FROM vehicle_brands WHERE name = '东风纳米'
        UNION ALL SELECT 'LVOVERVIEW016', id, '苏E-N003', 'offline', 'normal' FROM vehicle_brands WHERE name = '东风纳米';

        INSERT INTO hourly_online_vehicle_counts (hour, online_count)
        VALUES
          (0, 328), (1, 311), (2, 296), (3, 284), (4, 279), (5, 302),
          (6, 386), (7, 521), (8, 704), (9, 858), (10, 936), (11, 984),
          (12, 942), (13, 918), (14, 967), (15, 1026), (16, 1098), (17, 1164),
          (18, 1212), (19, 1186), (20, 1074), (21, 913), (22, 722), (23, 516);
      `);
    }
  },
  {
    id: '005_seed_admin_role_permissions',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO permissions (code, name, description)
        VALUES
          ('dashboard:view', '平台总览', '访问车联网运营平台总览'),
          ('account:center', '账号中心', '访问用户、角色与权限管理'),
          ('agent:center', '智能体中心', '访问智能体中心预留入口');

        INSERT OR IGNORE INTO roles (code, name, description, is_system)
        VALUES
          ('super_admin', '超级管理员', '拥有全部系统功能模块访问权限', 1),
          ('admin', '管理员', '拥有全部系统功能模块访问权限', 1);

        UPDATE roles
        SET is_system = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE code IN ('super_admin', 'admin');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
        SELECT roles.id, permissions.id
        FROM roles
        CROSS JOIN permissions
        WHERE roles.code IN ('super_admin', 'admin');
      `);
    }
  }
];

export function getDatabasePath(): string {
  return resolve(process.env.SQLITE_PATH ?? defaultDatabasePath);
}

export function openDatabase(databasePath = getDatabasePath()): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');

  return db;
}

export function runMigrations(databasePath = getDatabasePath()): MigrationResult {
  const db = openDatabase(databasePath);
  const appliedMigrations: string[] = [];

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1');
    const recordMigration = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

    for (const migration of migrations) {
      if (hasMigration.get(migration.id)) {
        continue;
      }

      db.exec('BEGIN;');
      try {
        migration.up(db);
        recordMigration.run(migration.id);
        db.exec('COMMIT;');
        appliedMigrations.push(migration.id);
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    }
  } finally {
    db.close();
  }

  return {
    databasePath,
    appliedMigrations
  };
}

export function getBootstrapSummary(databasePath = getDatabasePath()) {
  const db = openDatabase(databasePath);

  try {
    const migrationsCount = db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    const usersCount = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const rolesCount = db.prepare('SELECT COUNT(*) AS count FROM roles').get() as { count: number };
    const permissions = db
      .prepare('SELECT code, name FROM permissions ORDER BY id')
      .all() as Array<{ code: string; name: string }>;

    return {
      databasePath,
      migrationsCount: migrationsCount.count,
      usersCount: usersCount.count,
      rolesCount: rolesCount.count,
      permissions
    };
  } finally {
    db.close();
  }
}

export function getPlatformOverview(databasePath = getDatabasePath()): PlatformOverview {
  const db = openDatabase(databasePath);

  try {
    const metrics = db
      .prepare(
        `
          SELECT
            COUNT(*) AS registeredVehicles,
            SUM(CASE WHEN connection_status = 'online' THEN 1 ELSE 0 END) AS onlineVehicles,
            SUM(CASE WHEN alert_status = 'active' THEN 1 ELSE 0 END) AS alertVehicles
          FROM vehicles
        `
      )
      .get() as PlatformOverview['metrics'];

    const brandOnlineVehicles = db
      .prepare(
        `
          SELECT vehicle_brands.name AS brand,
                 SUM(CASE WHEN vehicles.connection_status = 'online' THEN 1 ELSE 0 END) AS onlineVehicles
          FROM vehicle_brands
          LEFT JOIN vehicles ON vehicles.brand_id = vehicle_brands.id
          GROUP BY vehicle_brands.id
          ORDER BY vehicle_brands.display_order, vehicle_brands.id
        `
      )
      .all() as PlatformOverview['brandOnlineVehicles'];

    const hourlyOnlineVehicles = db
      .prepare(
        `
          SELECT printf('%02d:00', hour) AS hour,
                 online_count AS onlineVehicles
          FROM hourly_online_vehicle_counts
          ORDER BY hour
        `
      )
      .all() as PlatformOverview['hourlyOnlineVehicles'];

    return {
      metrics: {
        registeredVehicles: metrics.registeredVehicles ?? 0,
        onlineVehicles: metrics.onlineVehicles ?? 0,
        alertVehicles: metrics.alertVehicles ?? 0
      },
      brandOnlineVehicles,
      hourlyOnlineVehicles
    };
  } finally {
    db.close();
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [algorithm, salt, expectedHash] = passwordHash.split(':');

  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const expected = Buffer.from(expectedHash, 'hex');
  const actual = scryptSync(password, salt, expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
