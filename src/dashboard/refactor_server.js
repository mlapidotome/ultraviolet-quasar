const fs = require('fs');
const crypto = require('crypto');
const path = 'c:\\Users\\Marcel\\.gemini\\antigravity\\playground\\ultraviolet-quasar\\src\\dashboard\\server.js';
let content = fs.readFileSync(path, 'utf8');

// 1. db.initUsers and db.migrateJsonData
content = content.replace(
  'db.initUsers();\ndb.migrateJsonData();',
  '(async () => {\n  await db.initUsers();\n  await db.migrateJsonData();\n})();'
);

// 2. getAuthUser
content = content.replace(
  'function getAuthUser(req) {\n  const cookies = parseCookies(req);\n  const token = cookies.session_token;\n  if (!token) return null;\n  return db.getSession(token);\n}',
  'async function getAuthUser(req) {\n  const cookies = parseCookies(req);\n  const token = cookies.session_token;\n  if (!token) return null;\n  return await db.getSession(token);\n}'
);

// 3. await getAuthUser usages
content = content.replace(/const user = getAuthUser\(req\);/g, 'const user = await getAuthUser(req);');
content = content.replace(/const currentUser = getAuthUser\(req\);/g, 'const currentUser = await getAuthUser(req);');

// 4. db methods await
content = content.replace(/db\.authenticateUser\(/g, 'await db.authenticateUser(');
content = content.replace(/db\.createSession\(/g, 'await db.createSession(');
content = content.replace(/db\.deleteSession\(/g, 'await db.deleteSession(');
content = content.replace(/db\.togglePauta\(/g, 'await db.togglePauta(');
content = content.replace(/db\.toggleBulkPauta\(/g, 'await db.toggleBulkPauta(');
content = content.replace(/db\.saveAcompanhamento\(/g, 'await db.saveAcompanhamento(');
content = content.replace(/db\.getAcompanhamentosMap\(/g, 'await db.getAcompanhamentosMap(');
content = content.replace(/db\.getResumosMap\(/g, 'await db.getResumosMap(');
content = content.replace(/db\.saveResumo\(/g, 'await db.saveResumo(');

// 5. CACHE methods
content = content.replace(
  /function readCache\(\) \{\n  if \(!fs\.existsSync\(CACHE_PATH\)\) return \{\};\n  try \{ return JSON\.parse\(fs\.readFileSync\(CACHE_PATH, 'utf8'\)\); \} catch \{ return \{\}; \}\n\}/g,
  "async function readCache() {\n  return await db.getKv('cache_historicos') || {};\n}"
);
content = content.replace(
  /function writeCache\(data\) \{\n  const tmpPath = CACHE_PATH \+ '\.tmp';\n  fs\.writeFileSync\(tmpPath, JSON\.stringify\(data, null, 2\)\);\n  fs\.renameSync\(tmpPath, CACHE_PATH\);\n\}/g,
  "async function writeCache(data) {\n  await db.setKv('cache_historicos', data);\n}"
);

// update readCache and writeCache calls
content = content.replace(/const cache = readCache\(\);/g, 'const cache = await readCache();');
content = content.replace(/const updatedCache = readCache\(\);/g, 'const updatedCache = await readCache();');
content = content.replace(/writeCache\(cache\);/g, 'await writeCache(cache);');
content = content.replace(/writeCache\(updatedCache\);/g, 'await writeCache(updatedCache);');

// 6. JSON File reads
content = content.replace(/JSON\.parse\(fs\.readFileSync\(DATA_PATH, 'utf8'\)\)/g, "(await db.getKv('bali_test_33a') || {})");
content = content.replace(/fs\.readFileSync\(DATA_PATH, 'utf8'\)/g, "JSON.stringify(await db.getKv('bali_test_33a') || {})");
content = content.replace(/JSON\.parse\(fs\.readFileSync\(TELEFONES_PATH, 'utf8'\)\)/g, "(await db.getKv('telefones_cache') || {})");

// TELEFONES_PATH exist check logic in resumos
content = content.replace(
  /const TELEFONES_PATH = path\.join\(__dirname, '\.\.', '\.\.', 'data', 'telefones_cache\.json'\);\n\s*let telefonesCache = \{\};\n\s*if \(fs\.existsSync\(TELEFONES_PATH\)\) \{\n\s*try \{ telefonesCache = JSON\.parse\(fs\.readFileSync\(TELEFONES_PATH, 'utf8'\)\); \} catch\(e\)\{\}\n\s*\}/g,
  "let telefonesCache = await db.getKv('telefones_cache') || {};"
);

// TELEFONES_PATH in api/phones
content = content.replace(
  /const TELEFONES_PATH = path\.join\(__dirname, '\.\.', '\.\.', 'data', 'telefones_cache\.json'\);\n\s*let telefones = \{\};\n\s*if \(fs\.existsSync\(TELEFONES_PATH\)\) \{\n\s*try \{ telefones = JSON\.parse\(fs\.readFileSync\(TELEFONES_PATH, 'utf8'\)\); \} catch\(e\)\{\}\n\s*\}/g,
  "let telefones = await db.getKv('telefones_cache') || {};"
);

// TELEFONES_PATH in sync-page
content = content.replace(
  /const TELEFONES_PATH = path\.join\(__dirname, '\.\.', '\.\.', 'data', 'telefones_cache\.json'\);\n\s*let telefones = \{\};\n\s*if \(fs\.existsSync\(TELEFONES_PATH\)\) \{\n\s*try \{ telefones = JSON\.parse\(fs\.readFileSync\(TELEFONES_PATH, 'utf8'\)\); \} catch\(e\)\{\}\n\s*\}/g,
  "let telefones = await db.getKv('telefones_cache') || {};"
);

// Sync telefones writes
content = content.replace(
  /const tmpPath = TELEFONES_PATH \+ '\.tmp';\n\s*fs\.writeFileSync\(tmpPath, JSON\.stringify\(telefones, null, 2\)\);\n\s*fs\.renameSync\(tmpPath, TELEFONES_PATH\);/g,
  "await db.setKv('telefones_cache', telefones);"
);

// sync/apply writes
content = content.replace(
  /if \(fs\.existsSync\(DATA_PATH\)\) \{\n\s*fs\.copyFileSync\(DATA_PATH, backupPath\);\n\s*\}/g,
  "const currentData = await db.getKv('bali_test_33a');\n        if (currentData) {\n          fs.writeFileSync(backupPath, JSON.stringify(currentData, null, 2));\n        }"
);
content = content.replace(
  /const tmpPath = simStagingPath \+ '\.tmp';\n\s*fs\.writeFileSync\(tmpPath, JSON\.stringify\(session\.stagedData, null, 2\), 'utf8'\);\n\s*fs\.renameSync\(tmpPath, simStagingPath\);/g,
  "await db.setKv('bali_test_33a_staging_applied', session.stagedData);"
);
content = content.replace(
  /const tmpPath = DATA_PATH \+ '\.tmp';\n\s*fs\.writeFileSync\(tmpPath, JSON\.stringify\(session\.stagedData, null, 2\), 'utf8'\);\n\s*fs\.renameSync\(tmpPath, DATA_PATH\);/g,
  "await db.setKv('bali_test_33a', session.stagedData);"
);

// Checksums and file tests: 
// getFileChecksum(DATA_PATH)
content = content.replace(
  /const baseDbChecksum = getFileChecksum\(DATA_PATH\);/g,
  "const baseDbData = await db.getKv('bali_test_33a');\n        const baseDbChecksum = crypto.createHash('sha256').update(JSON.stringify(baseDbData || {})).digest('hex');"
);
content = content.replace(
  /const currentDbChecksum = getFileChecksum\(DATA_PATH\);/g,
  "const currentDbData = await db.getKv('bali_test_33a');\n        const currentDbChecksum = crypto.createHash('sha256').update(JSON.stringify(currentDbData || {})).digest('hex');"
);

// And we make callbacks async where we added awaits!
content = content.replace(/req\.on\('end', \(\) => \{/g, "req.on('end', async () => {");

fs.writeFileSync(path, content, 'utf8');
console.log('Done!');
