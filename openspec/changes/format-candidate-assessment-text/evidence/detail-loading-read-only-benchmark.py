"""Read-only metadata timings; no candidate text or credentials leave the VPS."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode', choices=['prototype', 'deployed'], required=True)
args = parser.parse_args()
probe = r'''
import {serverContainer} from './server/configuration/container.ts';
import {PostgresProductRepository} from './server/product/postgres-repository.ts';
const mode=MODE, c=await serverContainer(), results=[];
try {
 const samples=await c.sql.begin('read only',async tx=>{
  await tx`SET LOCAL statement_timeout='3s'`;
  return tx`SELECT id,record_json::jsonb->'id' AS public_id FROM candidates
   WHERE id IN (SELECT candidate_id FROM candidate_report_versions WHERE state='PUBLISHED')
   ORDER BY id DESC LIMIT 3`;
 });
 let query;
 if(mode==='prototype') {
  const captured=[];
  await new PostgresProductRepository((parts,...values)=>{captured.push({parts,values});return Promise.resolve([]);}).dashboardSource();
  if(captured[3].values.length)throw Error('Unexpected baseline parameters');
  query=captured[3].parts.join('');
 }
 for(const sample of samples){
  const started=performance.now();
  const data=await c.sql.begin('read only',async tx=>{
   await tx`SET LOCAL statement_timeout='5s'`;
   if(mode==='deployed')return new PostgresProductRepository(tx).dashboardSource({candidateId:sample.public_id});
   const targeted=query.replace("published.state='PUBLISHED'","published.state='PUBLISHED' AND published.candidate_id="+Number(sample.id))
    .replace("WHERE r.state='PUBLISHED' AND d.drive_file_id IS NOT NULL","WHERE r.state='PUBLISHED' AND r.candidate_id="+Number(sample.id)+" AND d.drive_file_id IS NOT NULL");
   return tx.unsafe(targeted);
  });
  const readMs=Math.round(performance.now()-started);
  const serialized=JSON.stringify(data);
  results.push({sample:results.length+1,readMs,bytes:Buffer.byteLength(serialized),candidateCount:mode==='deployed'?data.candidates.length:1,reportRows:mode==='prototype'?data.length:undefined});
 }
 console.log(JSON.stringify({mode,readOnly:true,providerCalls:false,results}));
}catch(error){console.log(JSON.stringify({mode,readOnly:true,status:'FAILED',code:typeof error?.code==='string'?error.code:'PROBE_FAILED',completedSamples:results.length}));process.exitCode=1;}
finally{await c.close();}
'''.replace('MODE', json.dumps(args.mode))
ssh = ['C:/Windows/System32/OpenSSH/ssh.exe', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oConnectTimeout=15', 'root@139.100.220.7']
result = subprocess.run(ssh + ['docker exec -i -w /app/web hh-agent-web-1 node --import tsx --input-type=module'], input=probe, text=True, capture_output=True, encoding='utf-8', timeout=35)
if result.returncode:
    raise RuntimeError('Read-only benchmark failed: ' + result.stdout[-600:])
evidence = json.loads(result.stdout)
evidence['generatedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
evidence['sourceSha'] = subprocess.check_output(ssh + ['git -C /root/hr rev-parse HEAD'], text=True, timeout=15).strip()
Path(__file__).with_name('detail-loading-' + args.mode + '-timings.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
print(json.dumps(evidence))
