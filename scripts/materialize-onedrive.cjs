// Optional Windows workaround: atomically replace tracked Docker input files with
// identical local bytes. OneDrive cloud reparse entries confuse BuildKit/globs.
// No secrets, directories, dependencies, or database volumes are removed/moved.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z', '--', 'backend/src', 'backend/scripts', 'backend/package.json', 'backend/package-lock.json', 'frontend/src', 'frontend/public', 'frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json'], { cwd:root, encoding:'utf8' }).split('\0').filter(Boolean);
const digest = data => createHash('sha256').update(data).digest('hex');
let count = 0;
for (const name of files) {
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || fs.lstatSync(file).isSymbolicLink()) throw Error('Refusing an unexpected path or actual symlink');
  const entry = fs.readdirSync(path.dirname(file), {withFileTypes:true}).find(item=>item.name===path.basename(file));
  if (entry.isFile()) continue;
  const data = fs.readFileSync(file), temporary = file + '.local-materializing';
  fs.writeFileSync(temporary,data);
  fs.renameSync(temporary,file);
  if (digest(fs.readFileSync(file)) !== digest(data)) throw Error('Materialized file content did not match');
  count++;
}
console.log(`Materialized ${count} tracked Docker input files with byte-for-byte matching content.`);
