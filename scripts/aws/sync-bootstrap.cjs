const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'infra/option-b.json');
const template = JSON.parse(fs.readFileSync(file));
template.Resources.LaunchTemplate.Properties.LaunchTemplateData.UserData['Fn::Base64']['Fn::Sub'] = fs.readFileSync(path.join(root, 'infra/bootstrap.sh'), 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(file, JSON.stringify(template, null, 2) + '\n');
