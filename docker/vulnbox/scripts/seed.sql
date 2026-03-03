CREATE DATABASE IF NOT EXISTS vulnbox;
USE vulnbox;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user',
    api_key VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO users (username, password, email, role, api_key) VALUES
('admin', 'admin123', 'admin@vulnbox.local', 'admin', 'sk-vuln-admin-key-12345678'),
('john', 'john2024', 'john@vulnbox.local', 'user', 'sk-vuln-user-key-87654321'),
('deploy', 'deploy', 'deploy@vulnbox.local', 'admin', 'sk-vuln-deploy-key-abcdef'),
('backup', 'backup', 'backup@vulnbox.local', 'user', NULL),
('test', 'test', 'test@vulnbox.local', 'user', NULL),
('guest', 'guest', 'guest@vulnbox.local', 'guest', NULL);

CREATE TABLE IF NOT EXISTS secrets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO secrets (name, value) VALUES
('db_password', 'SuperSecret2024!'),
('api_master_key', 'master-key-do-not-share-98765'),
('ssh_private_key', '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-for-testing\n-----END OPENSSH PRIVATE KEY-----'),
('aws_access_key', 'AKIAIOSFODNN7EXAMPLE'),
('aws_secret_key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');

CREATE TABLE IF NOT EXISTS notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    title VARCHAR(200),
    content TEXT
);

INSERT IGNORE INTO notes (user_id, title, content) VALUES
(1, 'Server Credentials', 'SSH root:toor on port 2222'),
(1, 'API Keys', 'Master key: master-key-do-not-share-98765'),
(2, 'Meeting Notes', 'Discuss password policy changes');
