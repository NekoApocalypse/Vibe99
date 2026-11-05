const { spawn } = require('node:child_process');
const fs = require('node:fs');
const host = process.argv[2];
if (!host || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host)) throw Error('Pass an authorized Linux SSH host');
const helper = fs.readFileSync('remote/store_clipboard_image.py').toString('base64');
const code = `import base64,io,os,pathlib,stat,tempfile,time,json
scope={'__name__':'upload_test'}
exec(compile(base64.b64decode('${helper}'),'upload','exec'),scope)
store=scope['store']
original=tempfile.gettempdir
with tempfile.TemporaryDirectory(prefix='vibe99-upload-test-') as folder:
 tempfile.gettempdir=lambda: folder
 try:
  png=bytes([137,80,78,71,13,10,26,10])+b'fixture'
  first=pathlib.Path(store(io.BytesIO(png)))
  assert first.read_bytes()==png
  assert stat.S_IMODE(first.stat().st_mode)==0o600
  assert stat.S_IMODE(first.parent.stat().st_mode)==0o700
  second=pathlib.Path(store(io.BytesIO(png)))
  assert first!=second and first.exists()
  os.utime(first,(time.time()-8*86400,)*2)
  sentinel=pathlib.Path(folder)/'sentinel';sentinel.write_bytes(b'preserve')
  link=second.parent/'image-link.png';link.symlink_to(sentinel)
  store(io.BytesIO(png))
  assert not first.exists() and second.exists() and link.is_symlink() and sentinel.read_bytes()==b'preserve'
  for data in [b'not PNG',png+b'x'*(16*1024*1024)]:
   try: store(io.BytesIO(data));raise AssertionError('Accepted invalid input')
   except ValueError: pass
  parent=second.parent;saved=parent.with_name(parent.name+'-saved');parent.rename(saved);parent.symlink_to(saved,target_is_directory=True)
  try: store(io.BytesIO(png));raise AssertionError('Followed a symlink directory')
  except ValueError: pass
  print(json.dumps({'passed':['exact bytes and private permissions','unique durable filenames','seven-day cleanup preserves fresh files and symlinks','invalid/oversize input rejection','symlink directory rejection']}))
 finally: tempfile.gettempdir=original
`;
const p = spawn('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host, 'python3 -'], { windowsHide: true });
p.stdin.end(code); p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr);
const timer = setTimeout(() => p.kill(), 30000);
p.on('exit', status => { clearTimeout(timer); process.exitCode = status === 0 ? 0 : 1; });
