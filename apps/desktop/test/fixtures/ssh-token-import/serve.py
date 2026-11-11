import argparse,json,os,pathlib,secrets,socket,subprocess,time,urllib.request,urllib.error
parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--cutex',required=True);args=parser.parse_args()
root=pathlib.Path(args.root).resolve();root.mkdir(mode=0o700,exist_ok=False)
if os.name=='nt':
 sid=subprocess.check_output(['whoami','/user','/fo','csv','/nh'],text=True).strip().split(',')[-1].strip('"')
 subprocess.run(['icacls',str(root),'/inheritance:r','/grant:r',f'*{sid}:(OI)(CI)F'],check=True,stdout=subprocess.DEVNULL)
binary=str(pathlib.Path(args.cutex).resolve());children=[]
def free(low):
 for port in range(low,low+50):
  try:
   with socket.socket() as s:s.bind(('127.0.0.1',port));return port
  except OSError:pass
 raise RuntimeError('no loopback test ports')
def req(info,method,path,body=None):
 r=urllib.request.Request(f'http://127.0.0.1:{info["port"]}'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+info['owner'],'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(r,timeout=15) as response:return json.load(response)
try:
 fixture={}
 for name in ('remote','secondary'):
  home=root/name;home.mkdir();(home/'.cutex-test-private-home').touch();cfgdir=home/'.cutex';cfgdir.mkdir();workspace=home/'workspace';workspace.mkdir();tmp=home/'tmp';tmp.mkdir()
  info={'port':free(24650),'owner':secrets.token_hex(32)};bus=free(24750)
  cfg={'agent_bus_enabled':True,'agent_bus_port':bus,'agent_bus_token':secrets.token_hex(32),'management_port':info['port'],'management_api_token':info['owner'],'agent_management_admin_token':info['owner'],'management_listen':[f'127.0.0.1:{info["port"]}'],'usage':{'priceSource':'manual'}}
  (cfgdir/'config.json').write_text(json.dumps(cfg))
  env={k:v for k,v in os.environ.items() if not k.startswith(('CUTEX','CLAUDE','CODEX','ANTHROPIC'))}
  env.update(HOME=str(home),USERPROFILE=str(home),CUTEX_TEST_PRIVATE_HOME=str(home),CUTEX_TEST_FORBID_REAL_HOME='1',TEMP=str(tmp),TMP=str(tmp),TMPDIR=str(tmp))
  for parts in (['agent','serve','--port',str(bus)],['management','serve','--port',str(info['port'])]):
   log=open(home/('-'.join(parts[:2])+'.log'),'ab');p=subprocess.Popen([binary,*parts],env=env,cwd=workspace,stdin=subprocess.DEVNULL,stdout=log,stderr=log,**({'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {'start_new_session':True}));log.close();children.append(p)
  until=time.monotonic()+60
  while True:
   try:info['hostId']=req(info,'GET','/v2/host')['hostId'];break
   except Exception:
    if time.monotonic()>until:raise
    time.sleep(.3)
  for project in ('ema-project','owner-only-project'):
   req(info,'POST','/v2/agent-management/project-mutations',{'schema':'cutex/human-management-project-mutation/v1','project_id':project,'operation':{'kind':'create_project','presentation':{'display_name':project,'badge_label':'EMA' if project=='ema-project' else 'OWN','color':'cyan'},'workspace_root':str(workspace)}})
  user=req(info,'POST','/v2/users',{'name':'ema','grant':{'projects':['ema-project'],'standaloneAgents':[],'send':True}})['user']['id']
  out=subprocess.check_output([binary,'management','client-token','issue','--label','ema-private-e2e','--user',user,'--scope','full'],env=env,cwd=workspace,stderr=subprocess.PIPE,text=True)
  info.update(token=json.loads(out)['token'],userId=user);fixture[name]=info
 (root/'fixture.json').write_text(json.dumps(fixture));(root/'pids.json').write_text(json.dumps([p.pid for p in children]));print('READY: two private debug daemons, two projects each, ema grant for one project',flush=True)
 until=time.monotonic()+1200
 while not (root/'STOP').exists() and time.monotonic()<until:time.sleep(.5)
finally:
 for p in reversed(children):
  if p.poll() is None:p.terminate();p.wait(timeout=20)
 (root/'fixture.json').unlink(missing_ok=True)
 print('Stopped only owned process handles; private token fixture removed',flush=True)
