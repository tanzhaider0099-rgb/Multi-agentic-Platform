const db = require('./db');
const vault = require('./vault');
const projects = require('./projects');

function listEntities() {
  return db.listEntities();
}

function getEntity(name) {
  const entity = db.getEntity(name);
  if (!entity) throw new Error(`No entity named "${name}" was found.`);
  return entity;
}

function saveEntity(entity) {
  if (!entity.name || !entity.name.trim()) throw new Error('An entity needs a name.');
  db.saveEntity(entity);
  const active = projects.getActiveProject();
  let vaultPath = null;
  if (active) {
    try { vaultPath = vault.writeEntityMarkdown(active.rootPath, entity); }
    catch (err) { vaultPath = null; }
  }
  return { name: entity.name, vaultPath, vaultWritten: !!vaultPath };
}

function deleteEntity(name) {
  db.deleteEntity(name);
  return true;
}

module.exports = { listEntities, getEntity, saveEntity, deleteEntity };
