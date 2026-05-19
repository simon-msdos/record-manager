-- Migration to support record-level permissions
CREATE TABLE IF NOT EXISTS record_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain_id INTEGER NOT NULL,
    record_id TEXT NOT NULL,
    level TEXT NOT NULL, -- 'read', 'edit', 'delete'
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    UNIQUE(user_id, domain_id, record_id)
);
