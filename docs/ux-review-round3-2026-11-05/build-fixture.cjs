// Build the current code with CI's public placeholder configuration. No real
// account or production environment is loaded. Use Node 24 as in repository CI.
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const budget=JSON.parse(fs.readFileSync(path.join(repo,'docs/quality/bundle-budget.json')));
const result=spawnSync('npm',['run','build'],{cwd:repo,env:{...process.env,...budget.measuredBuild.env},stdio:'inherit'});
process.exit(result.status??1);
