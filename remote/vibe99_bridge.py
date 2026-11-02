"""Ephemeral Linux SSH bridge, adapted from Owlet's read-only preview protocol."""
import base64, concurrent.futures, fcntl, json, os, pty, queue, select, shlex, shutil
import signal, socket, stat, struct, subprocess, sys, tempfile, termios, threading, time, urllib.parse

MAX_TEXT = 4 * 1024 * 1024
MAX_IMAGE = 16 * 1024 * 1024
output_control = queue.Queue(maxsize=64)
output_files = queue.Queue(maxsize=2)
output_terminal = queue.Queue(maxsize=1024)
output_ready = threading.Event()
terminal_lock = threading.Lock()
terminals = {}
stopping = threading.Event()
cleanup_lock = threading.Lock()
shutdown_requested = threading.Event()
last_ping = time.monotonic()
session_dir = None

def emit(value, control=False):
    event = value.get('event')
    # Exit must remain behind every data packet already queued for its terminal.
    target = output_terminal if event in ('terminal-data', 'terminal-exit') else (output_control if control or event is not None else output_files)
    if target is output_control:
        # Never hold up the stdin dispatcher behind a file/terminal stdout write.
        target.put_nowait(value)
        output_ready.set()
        return
    while not stopping.is_set():
        try:
            target.put(value, timeout=.2)
            output_ready.set()
            return
        except queue.Full: pass

def output_writer():
    try:
        while not stopping.is_set():
            value = None
            for channel in (output_control, output_files, output_terminal):
                try:
                    value = channel.get_nowait()
                    break
                except queue.Empty: pass
            if value is None:
                output_ready.wait(.1)
                output_ready.clear()
                continue
            sys.stdout.write(json.dumps(value, ensure_ascii=True) + '\n')
            sys.stdout.flush()
    except (OSError, ValueError):
        request_shutdown(None, None)


def resolve(path):
    if not isinstance(path, str) or '\0' in path:
        raise ValueError('Invalid path')
    return os.path.abspath(os.path.expanduser(path))

def stat_file(path):
    path = resolve(path)
    info = os.stat(path)
    return dict(path=path, directory=stat.S_ISDIR(info.st_mode), size=info.st_size,
                stamp=f'{info.st_mtime_ns}:{info.st_ctime_ns}:{info.st_size}')

def image_path(args):
    source = args.get('source', args.get('path', ''))
    parsed = urllib.parse.urlsplit(source)
    if parsed.scheme or parsed.netloc:
        raise ValueError('External image URLs are not loaded')
    source = urllib.parse.unquote(parsed.path)
    base = os.path.dirname(resolve(args.get('document', '/')))
    root = resolve(args.get('root', base))
    candidates = [os.path.normpath(os.path.join(base, source))]
    if not source.startswith(('/', './', '../')):
        if os.path.commonpath([root, base]) == root:
            while base != root:
                base = os.path.dirname(base)
                candidates.append(os.path.join(base, source))
        else:
            candidates.append(os.path.join(root, source))
    for candidate in candidates:
        if os.path.isfile(candidate): return candidate
    raise ValueError('Image not found')

def read_file(args, image=False):
    path = image_path(args) if image else resolve(args['path'])
    before = stat_file(path)
    if before['directory']: raise ValueError('Choose a regular file')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('Choose a regular file')
        data = stream.read((MAX_IMAGE if image else MAX_TEXT) + 1)
    if len(data) > (MAX_IMAGE if image else MAX_TEXT): raise ValueError('File exceeds preview size limit')
    if stat_file(path)['stamp'] != before['stamp']: raise ValueError('File changed while reading; retry')
    if image:
        mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.bmp':'image/bmp'}.get(os.path.splitext(path)[1].lower())
        if not mime: raise ValueError('Unsupported image format')
        return dict(path=path, url='data:' + mime + ';base64,' + base64.b64encode(data).decode())
    if b'\0' in data: raise ValueError('Binary files cannot be previewed')
    return dict(path=path, text=data.decode('utf-8-sig'), stamp=before['stamp'])

def list_dir(args):
    path = resolve(args['path'])
    offset = max(0, int(args.get('offset', 0)))
    entries = []
    with os.scandir(path) as items:
        for index, item in enumerate(items):
            if index < offset: continue
            try:
                entries.append(dict(name=item.name,path=item.path,directory=item.is_dir(),size=item.stat().st_size))
            except OSError: continue
            if len(entries) > 100: break
    more = len(entries) > 100
    entries = sorted(entries[:100], key=lambda x:(not x['directory'],x['name'].lower()))
    return dict(path=path,entries=entries,next=offset+100 if more else None)

class Terminal:
    def __init__(self, identifier, process, fd):
        self.identifier, self.process, self.fd = identifier, process, fd
        self.condition = threading.Condition()
        self.pending = {}
        self.sequence = 0
        self.cancelled = False
        self.input = bytearray()
        self.termination_lock = threading.Lock()
        self.terminated = False
    def cancel(self):
        with self.condition:
            self.cancelled = True
            self.condition.notify_all()
    def ack(self, sequence):
        with self.condition:
            if sequence > self.sequence: raise ValueError('Invalid acknowledgement')
            self.pending = {k:v for k,v in self.pending.items() if k > sequence}
            self.condition.notify_all()
    def output(self):
        try:
            while not stopping.is_set():
                with self.condition:
                    while not self.cancelled and (len(self.pending) >= 64 or sum(self.pending.values()) >= 256*1024):
                        self.condition.wait(.5)
                    if self.cancelled: break
                if not select.select([self.fd], [], [], .2)[0]: continue
                data = os.read(self.fd, 4096)
                if not data: break
                with self.condition:
                    self.sequence += 1
                    seq = self.sequence
                    self.pending[seq] = len(data)
                emit(dict(event='terminal-data',terminal=self.identifier,data=base64.b64encode(data).decode(),sequence=seq))
        except OSError: pass
        finally:
            self.cancel()
            terminate(self)
            with terminal_lock:
                if terminals.get(self.identifier) is self: terminals.pop(self.identifier, None)
            try: os.close(self.fd)
            except OSError: pass
            if not stopping.is_set(): emit(dict(event='terminal-exit',terminal=self.identifier,status=self.process.poll()))
    def write_input(self):
        while not self.cancelled and not stopping.is_set():
            with self.condition:
                if not self.input:
                    self.condition.wait(.2)
                    continue
                data = bytes(self.input[:4096])
            try:
                if not select.select([], [self.fd], [], .2)[1]: continue
                count = os.write(self.fd, data)
                with self.condition: del self.input[:count]
            except BlockingIOError: continue
            except OSError: break

def terminate(terminal):
    with terminal.termination_lock:
        if terminal.terminated: return
        terminal.terminated = True
        terminate_owned(terminal)

def terminate_owned(terminal):
    terminal.cancel()
    # The foreground job may have its own process group. Capture only the group
    # attached to our owned PTY, never enumerate or kill unrelated user processes.
    groups = {terminal.process.pid}
    try: groups.add(os.tcgetpgrp(terminal.fd))
    except OSError: pass
    # Bash job control creates additional groups in this owned session.
    # Capture those groups before terminating the session leader.
    try:
        for name in os.listdir('/proc'):
            if not name.isdigit(): continue
            try:
                with open('/proc/' + name + '/stat') as info:
                    fields = info.read().rsplit(')', 1)[1].split()
                if int(fields[3]) == terminal.process.pid:
                    groups.add(int(fields[2]))
            except (OSError, ValueError, IndexError): pass
    except OSError: pass
    groups.discard(0)
    groups.discard(os.getpgrp())
    for group in groups:
        try: os.killpg(group, signal.SIGHUP)
        except ProcessLookupError: pass
    try: terminal.process.wait(timeout=1)
    except subprocess.TimeoutExpired: pass
    for group in groups:
        try: os.killpg(group, signal.SIGKILL)
        except ProcessLookupError: pass
    try: terminal.process.wait(timeout=.5)
    except subprocess.TimeoutExpired: pass

def start_terminal(args):
    identifier = args['terminal']
    with terminal_lock:
        if stopping.is_set(): raise ValueError('Workspace is closing')
        if identifier in terminals: raise ValueError('Terminal already exists')
        if len(terminals) >= 16: raise ValueError('Terminal limit reached')
        rows=max(1,min(1000,int(args.get('rows',24))))
        cols=max(1,min(1000,int(args.get('cols',80))))
        fd, slave = pty.openpty()
        try: fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
        except Exception:
            os.close(fd);os.close(slave)
            raise
        env = dict(os.environ, TERM='xterm-256color',COLORTERM='truecolor',VIBE99_SOCKET=os.path.join(session_dir,'open.sock'))
        code = 'import os,sys,fcntl,termios;fcntl.ioctl(0,termios.TIOCSCTTY,0);os.chdir(sys.argv[2]);os.execv("/bin/bash",["bash","--rcfile",sys.argv[1],"-i"])'
        try:
            process = subprocess.Popen([sys.executable,'-c',code,os.path.join(session_dir,'bashrc'),resolve(args['path'])],stdin=slave,stdout=slave,stderr=slave,cwd='/',env=env,start_new_session=True,close_fds=True)
        except Exception:
            os.close(fd)
            raise
        finally: os.close(slave)
        os.set_blocking(fd,False)
        terminal = Terminal(identifier,process,fd)
        terminals[identifier] = terminal
    threading.Thread(target=terminal.output,daemon=True).start()
    threading.Thread(target=terminal.write_input,daemon=True).start()
    return dict(terminal=identifier)

def dispatch(method,args):
    global last_ping
    if method == 'ping':
        last_ping = time.monotonic()
        return None
    if method == 'hello':
        root = resolve(args['root'])
        if not os.path.isdir(root): raise ValueError('Workspace root must be a directory')
        return dict(root=root,home=os.path.expanduser('~'),kind='ssh')
    if method == 'stat': return stat_file(args['path'])
    if method == 'read': return read_file(args)
    if method == 'image': return read_file(args,True)
    if method == 'list': return list_dir(args)
    if method == 'terminal-start': return start_terminal(args)
    if method.startswith('terminal-'):
        with terminal_lock: terminal = terminals.get(args['terminal'])
        if not terminal: return None
        if method == 'terminal-ack': terminal.ack(int(args['sequence']))
        elif method == 'terminal-input':
            data = base64.b64decode(args['data'],validate=True)
            with terminal.condition:
                if len(terminal.input)+len(data)>65536: raise ValueError('Terminal input queue full')
                terminal.input.extend(data)
                terminal.condition.notify_all()
        elif method == 'terminal-resize': fcntl.ioctl(terminal.fd,termios.TIOCSWINSZ,struct.pack('HHHH',max(1,min(1000,int(args['rows']))),max(1,min(1000,int(args['cols']))),0,0))
        elif method == 'terminal-close':
            terminal.cancel()
            threading.Thread(target=terminate,args=(terminal,),daemon=True).start()
        else: raise ValueError('Unknown method')
        return None
    raise ValueError('Unknown method: '+str(method))

def cleanup():
    with cleanup_lock:
        cleanup_owned()

def cleanup_owned():
    if stopping.is_set(): return
    stopping.set()
    with terminal_lock: owned = list(terminals.values())
    workers = [threading.Thread(target=terminate,args=(terminal,),daemon=True) for terminal in owned]
    for worker in workers: worker.start()
    deadline = time.monotonic()+2
    for worker in workers: worker.join(max(0,deadline-time.monotonic()))
    if session_dir: shutil.rmtree(session_dir,ignore_errors=True)

def watchdog():
    while not stopping.wait(1):
        if time.monotonic()-last_ping>60:
            cleanup()
            os._exit(0)

def accept_opens(listener):
    while not stopping.is_set():
        try: connection,_ = listener.accept()
        except socket.timeout: continue
        except OSError: break
        with connection:
            connection.settimeout(2)
            try:
                data = b''
                while b'\n' not in data and len(data)<16384:
                    chunk = connection.recv(4096)
                    if not chunk: break
                    data += chunk
                request = json.loads(data)
                path = resolve(request['path'])
                if not os.path.exists(path): raise ValueError('Path not found')
                emit(dict(event='open',path=path))
                connection.sendall(b'ok')
            except Exception: pass

def request_shutdown(signum, frame):
    if shutdown_requested.is_set(): return
    shutdown_requested.set()
    def finish():
        cleanup()
        os._exit(0)
    threading.Thread(target=finish,daemon=True).start()

def main():
    global session_dir
    for signum in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, request_shutdown)
    session_dir = tempfile.mkdtemp(prefix='vibe99-')
    bin_dir = os.path.join(session_dir,'bin')
    os.mkdir(bin_dir)
    launcher = '#!/usr/bin/env python3\nimport os,sys,socket,json\ns=socket.socket(socket.AF_UNIX);s.settimeout(3);s.connect(os.environ["VIBE99_SOCKET"]);s.sendall((json.dumps({"path":os.path.abspath(os.path.expanduser(sys.argv[1] if len(sys.argv)>1 else "."))})+"\\n").encode());s.recv(32)\n'
    with open(os.path.join(bin_dir,'vibe99'),'w') as stream: stream.write(launcher)
    os.chmod(os.path.join(bin_dir,'vibe99'),0o700)
    os.symlink('vibe99',os.path.join(bin_dir,'v99'))
    with open(os.path.join(session_dir,'bashrc'),'w') as stream:
        stream.write('[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\nexport PATH='+shlex.quote(bin_dir)+':"$PATH"\n')
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(os.path.join(session_dir,'open.sock'))
    os.chmod(os.path.join(session_dir,'open.sock'),0o600)
    listener.listen(8)
    listener.settimeout(1)
    threading.Thread(target=accept_opens,args=(listener,),daemon=True).start()
    threading.Thread(target=watchdog,daemon=True).start()
    threading.Thread(target=output_writer,daemon=True).start()
    emit(dict(event='ready'))
    slots = threading.BoundedSemaphore(16)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    def handle(request):
        try:
            result = dispatch(request['method'],request.get('args',{}))
            if 'id' in request: emit(dict(id=request['id'],result=result), control=request['method'].startswith('terminal-') or request['method']=='ping')
        except Exception as error:
            if 'id' in request: emit(dict(id=request['id'],error=str(error)), control=True)
    def job(request):
        try: handle(request)
        finally: slots.release()
    try:
        while True:
            line = sys.stdin.buffer.readline(128*1024+1)
            if not line: break
            if len(line)>128*1024: break
            request = json.loads(line)
            method = request.get('method','')
            if method == 'close': break
            if method in ('ping','terminal-ack','terminal-input','terminal-resize','terminal-close'): handle(request)
            elif slots.acquire(blocking=False): pool.submit(job,request)
            elif 'id' in request: emit(dict(id=request['id'],error='Request queue full'),control=True)
    finally:
        cleanup()
        listener.close()
        pool.shutdown(wait=False)
        os._exit(0)

if __name__ == '__main__':
    try: main()
    finally: cleanup()

