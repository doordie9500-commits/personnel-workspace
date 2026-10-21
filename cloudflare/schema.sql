-- Execute once using D1 console or wrangler d1 execute. Contains no user data.
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,login TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,role TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,created TEXT NOT NULL,actor TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recovery(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL);
INSERT OR IGNORE INTO workspace VALUES(1,0,'{"people":[],"events":[],"groups":[],"roles":["Мех. Вод.","Ком. Гар.","Навідник","номер обслуги #1","номер обслуги #2"],"title":"Кадровий простір"}');
