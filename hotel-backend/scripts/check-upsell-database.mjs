import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
const source=dotenv.parse(readFileSync('.env'));
const root=resolve(process.env.PMS_MCP_ROOT || '../../hotelogx-pms-mcp');
const python=process.env.PMS_MCP_PYTHON || resolve(root, process.platform==='win32'?'venv/Scripts/python.exe':'venv/bin/python');
const result=spawnSync(python,[resolve(root,'scripts/check_upsell_database.py')],{env:{...process.env,DATABASE_URL:source.DIRECT_DATABASE_URL||source.DATABASE_URL,UPSELL_MIGRATION:readFileSync('prisma/migrations/20261026020000_pms_upsell_tools/migration.sql','utf8')},encoding:'utf8',timeout:120000});
process.stdout.write(result.stdout||'');
if(result.status!==0){ console.error((result.stderr||'').replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]'));process.exit(1);}
