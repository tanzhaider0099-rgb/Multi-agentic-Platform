const fs = require('fs');
const path = require('path');
const config = require('./config');

const SUBFOLDERS = [
  '01_Raw_Sources',
  '02_Processed_Notes',
  '03_Entities/People',
  '03_Entities/Places',
  '04_Intelligence/Daily-Logs',
  '.hydra'
];

function ensureProjectFolders(rootPath) {
  for (const folder of SUBFOLDERS) {
    const full = path.join(rootPath, folder);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}

function slugFolderName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'Untitled Project';
}

function listProjects() {
  const cfg = config.getSafeConfig();
  return cfg.projects.map(p => ({ ...p, active: p.rootPath === cfg.activeProjectPath }));
}

function getActiveProject() {
  const cfg = config.getSafeConfig();
  if (!cfg.activeProjectPath) return null;
  const match = cfg.projects.find(p => p.rootPath === cfg.activeProjectPath);
  if (!match || !fs.existsSync(cfg.activeProjectPath)) return null;
  return match;
}

// parentDir: a folder the project directory gets created inside (e.g. Documents).
// The project itself becomes parentDir/<name>, and everything ingested for
// this project — raw files, processed notes, database — lives inside it.
function createProject(name, parentDir) {
  if (!name || !name.trim()) throw new Error('Give the project a name.');
  if (!parentDir) throw new Error('Choose a parent folder to create the project in.');
  if (!fs.existsSync(parentDir)) throw new Error('That parent folder does not exist.');

  const folderName = slugFolderName(name);
  const rootPath = path.join(parentDir, folderName);
  if (fs.existsSync(rootPath) && fs.readdirSync(rootPath).length > 0) {
    throw new Error(`"${folderName}" already exists there and isn't empty. Choose a different name or open it instead.`);
  }
  ensureProjectFolders(rootPath);

  const cfg = config.getSafeConfig();
  const projects = [...cfg.projects, { name: name.trim(), rootPath, createdAt: new Date().toISOString() }];
  config.setConfig({ projects, activeProjectPath: rootPath });
  return { name: name.trim(), rootPath };
}

// Opens an existing folder as a project. If it doesn't already look like a
// Hydra project, the folder structure is added without touching any
// existing files already inside it — this is exactly the "open a folder
// and it organizes what's inside" behavior that was asked for.
function openProjectFolder(rootPath, name) {
  if (!fs.existsSync(rootPath)) throw new Error('That folder does not exist.');
  ensureProjectFolders(rootPath);
  const cfg = config.getSafeConfig();
  const already = cfg.projects.find(p => p.rootPath === rootPath);
  let projects = cfg.projects;
  const displayName = name || path.basename(rootPath);
  if (!already) {
    projects = [...cfg.projects, { name: displayName, rootPath, createdAt: new Date().toISOString() }];
  }
  config.setConfig({ projects, activeProjectPath: rootPath });
  return { name: displayName, rootPath };
}

function switchProject(rootPath) {
  const cfg = config.getSafeConfig();
  const match = cfg.projects.find(p => p.rootPath === rootPath);
  if (!match) throw new Error('Unknown project.');
  if (!fs.existsSync(rootPath)) throw new Error('That project folder no longer exists on disk.');
  ensureProjectFolders(rootPath);
  config.setConfig({ activeProjectPath: rootPath });
  return match;
}

function removeProject(rootPath) {
  // Only forgets the project from Hydra's list — never deletes files on disk.
  const cfg = config.getSafeConfig();
  const projects = cfg.projects.filter(p => p.rootPath !== rootPath);
  const activeProjectPath = cfg.activeProjectPath === rootPath ? '' : cfg.activeProjectPath;
  config.setConfig({ projects, activeProjectPath });
  return true;
}

module.exports = { listProjects, getActiveProject, createProject, openProjectFolder, switchProject, removeProject, ensureProjectFolders, SUBFOLDERS };
