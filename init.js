'use strict';
// cms init <folder> [--name "Client Name"] [--repo owner/name]
// Starts a new client site from the starter: content, templates, assets and settings.
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

module.exports = function init(engine, target) {
  if (!target || target === process.cwd() + path.sep) throw new Error('Say which folder, like: cms init ../client-site --name "Client Name" --repo owner/name');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(target + ' is not empty. Pick a new folder.');
  const name = arg('name', 'Your Business Name');
  const repo = arg('repo', 'owner/repo');
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  const pkg = require('./package.json');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(engine, 'starter'), target, { recursive: true });
  fs.renameSync(path.join(target, 'gitignore.txt'), path.join(target, '.gitignore'));
  const fill = rel => {
    const p = path.join(target, rel);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/__NAME__/g, name).replace(/__REPO__/g, repo).replace(/__ID__/g, id));
  };
  fill('cms.config.json');
  fill('README.md');
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: id + '-site', private: true, version: '0.1.0', description: name + ' website and editor',
    dependencies: {
      '@netlify/functions': '^5.2.0',
      '@netlify/identity': '2.0.0',
      '@joeniemann/cms': 'github:joeniemann/cms#v' + pkg.version
    }
  }, null, 2) + '\n');
  console.log('Created ' + target);
  console.log('Next: open content/site.json and fill in the business details, then:');
  console.log('  npm install && npx cms build');
};
