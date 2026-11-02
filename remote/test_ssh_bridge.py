"""Explicit opt-in integration: python test_ssh_bridge.py user@authorized-host."""
import base64, pathlib, subprocess, sys
bridge=base64.b64encode(pathlib.Path(__file__).with_name('vibe99_bridge.py').read_bytes()).decode()
harness=r'''
import base64,json,os,pathlib,queue,re,shutil,signal,subprocess,sys,tempfile,threading,time
fixture=tempfile.mkdtemp(prefix='vibe99-integration-')
children=[]
class Bridge:
    def __init__(self):
        env=dict(os.environ,TMPDIR=fixture)
        self.p=subprocess.Popen([sys.executable,'-u',fixture+'/bridge.py'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,text=True)
        children.append(self.p);self.q=queue.Queue();self.events=[];self.seq=0
        def reader():
            for line in self.p.stdout:
                self.q.put(json.loads(line))
            self.q.put({'eof':True})
        threading.Thread(target=reader,daemon=True).start()
        assert self.next(10).get('event')=='ready'
    def next(self,timeout=5):
        value=self.q.get(timeout=timeout)
        if value.get('eof'): raise RuntimeError('bridge EOF: '+self.p.stderr.read())
        return value
    def request(self,method,args={}):
        self.seq+=1;ident=self.seq
        self.p.stdin.write(json.dumps(dict(id=ident,method=method,args=args))+'\n');self.p.stdin.flush()
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            value=self.next(max(.01,deadline-time.monotonic()))
            if value.get('id')==ident:
                assert 'error' not in value,value
                return value.get('result')
            self.events.append(value)
        raise TimeoutError(method)
    def ack(self):
        sequences=[e['sequence'] for e in self.events if e.get('event')=='terminal-data']
        if sequences:self.request('terminal-ack',dict(terminal='test',sequence=max(sequences)))
    def terminal(self):
        self.request('terminal-start',dict(terminal='test',path=fixture,cols=80,rows=24))
        self.request('terminal-input',dict(terminal='test',data=base64.b64encode(b'printf "__OWNED_PID__%s\\n" "$$"\n').decode()))
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            text=b''.join(base64.b64decode(e['data']) for e in self.events if e.get('event')=='terminal-data')
            match=re.search(rb'__OWNED_PID__(\d+)',text)
            if match:self.ack();return int(match.group(1))
            self.events.append(self.next(5));self.ack()
        raise TimeoutError('shell pid')
    def close(self):
        self.p.stdin.write('{"method":"close"}\n');self.p.stdin.flush()
        self.p.wait(timeout=5)
def dead(pid):
    try:os.kill(pid,0);return False
    except ProcessLookupError:return True
try:
    pathlib.Path(fixture+'/bridge.py').write_bytes(base64.b64decode(BRIDGE))
    pathlib.Path(fixture+'/note.md').write_text('# fixture\nhello')
    pathlib.Path(fixture+'/pixel.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII='))
    normal=Bridge()
    assert normal.request('hello',dict(root=fixture))['root']==fixture
    assert normal.request('read',dict(path=fixture+'/note.md'))['text']=='# fixture\nhello'
    assert normal.request('stat',dict(path=fixture+'/note.md'))['size']==15
    assert normal.request('image',dict(source='pixel.png',document=fixture+'/note.md',root=fixture))['url'].startswith('data:image/png;base64,')
    assert 'note.md' in [e['name'] for e in normal.request('list',dict(path=fixture))['entries']]
    pid=normal.terminal();normal.events.clear()
    command="python3 -c 'print(chr(88)*1048576+chr(70)*20)'\n"
    normal.request('terminal-input',dict(terminal='test',data=base64.b64encode(command.encode()).decode()))
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        try:normal.events.append(normal.next(.3))
        except queue.Empty:break
    packets=[e for e in normal.events if e.get('event')=='terminal-data']
    assert len(packets)<=64 and sum(len(base64.b64decode(e['data'])) for e in packets)<=262144,(len(packets),'window')
    assert len(packets)==64,('expected full packet window',len(packets),b''.join(base64.b64decode(e['data']) for e in packets)[-1500:])
    normal.request('stat',dict(path=fixture+'/note.md'))
    initial=len([e for e in normal.events if e.get('event')=='terminal-data'])
    try:unexpected=normal.next(.3);raise AssertionError(('produced past window',unexpected))
    except queue.Empty:pass
    print(json.dumps(dict(test='file-read-image-stat-list-and-flood',packets=initial,bytes=sum(len(base64.b64decode(e['data'])) for e in packets))),flush=True)
    deadline=time.monotonic()+15;total=bytearray()
    while time.monotonic()<deadline:
        batch=normal.events;normal.events=[]
        for e in batch:
            if e.get('event')=='terminal-data':total.extend(base64.b64decode(e['data']))
        sequences=[e['sequence'] for e in batch if e.get('event')=='terminal-data']
        if sequences:normal.request('terminal-ack',dict(terminal='test',sequence=max(sequences)))
        if b'FFFFFFFFFFFFFFFFFFFF\r\n' in total:break
        if not normal.events:normal.events.append(normal.next(5))
    assert b'FFFFFFFFFFFFFFFFFFFF\r\n' in total,'ACK did not release producer'
    print(json.dumps(dict(test='ack-resumes-output',bytes=len(total))),flush=True)
    sessions=[str(p) for p in pathlib.Path(fixture).glob('vibe99-*') if p.is_dir()]
    normal.close();assert dead(pid),'normal close left owned shell alive'
    assert all(not os.path.exists(p) for p in sessions),'normal close left session dir'
    print(json.dumps(dict(test='normal-close',owned_pid=pid,cleaned=True)),flush=True)
    heartbeat=Bridge();heartbeat.request('hello',dict(root=fixture));pid=heartbeat.terminal()
    sessions=[str(p) for p in pathlib.Path(fixture).glob('vibe99-*') if p.is_dir()]
    started=time.monotonic();heartbeat.p.wait(timeout=67)
    elapsed=time.monotonic()-started
    assert dead(pid),'heartbeat left shell alive'
    assert all(not os.path.exists(p) for p in sessions),'heartbeat left session dir'
    print(json.dumps(dict(test='watchdog-with-open-idle-stdin',seconds=round(elapsed,2),owned_pid=pid,cleaned=True)),flush=True)
finally:
    for child in children:
        if child.poll() is None:
            child.stdin.close()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill();child.wait()
    shutil.rmtree(fixture)
'''
# Raw harness needs ordinary Python string escape spelling, not the local shell's.
harness=harness.replace('\\\\','\\')
program='BRIDGE='+repr(bridge)+'\n'+harness
result=subprocess.run(['ssh','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','--',sys.argv[1],"python3 -u -c 'import sys;exec(compile(sys.stdin.buffer.read(),\"vibe99-integration\",\"exec\"))'"],input=program,text=True,timeout=110)
raise SystemExit(result.returncode)


