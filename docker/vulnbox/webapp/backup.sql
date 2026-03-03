-- VulnBox Database Backup
-- Generated: 2024-01-15
-- WARNING: This file should not be in the webroot!

CREATE DATABASE IF NOT EXISTS vulnbox;
USE vulnbox;

DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  role VARCHAR(20) DEFAULT 'user'
);

INSERT INTO users VALUES
(1, 'admin', 'admin123', 'admin@vulnbox.local', 'admin'),
(2, 'john', 'john2024', 'john@vulnbox.local', 'user'),
(3, 'deploy', 'deploy', 'deploy@vulnbox.local', 'admin'),
(4, 'backup', 'backup', 'backup@vulnbox.local', 'user'),
(5, 'test', 'test', 'test@vulnbox.local', 'user'),
(6, 'guest', 'guest', 'guest@vulnbox.local', 'guest');

DROP TABLE IF EXISTS secrets;
CREATE TABLE secrets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  value TEXT
);

INSERT INTO secrets VALUES
(1, 'db_password', 'SuperSecret2024!'),
(2, 'api_key', 'master-key-do-not-share-98765'),
(3, 'aws_access_key', 'AKIAIOSFODNN7EXAMPLE'),
(4, 'aws_secret_key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
(5, 'jwt_secret', 'secret'),
(6, 'ssh_key_path', '/root/.ssh/id_rsa'),
(7, 'ldap_bind_pass', 'ldap-svc-password'),
(8, 'smtp_password', 'Smtp_P@ss_2024!');
