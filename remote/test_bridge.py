"""Portable contract tests; Linux PTY integration still requires a Linux host."""
import ast, base64, io, json, os, pathlib, queue, signal, stat, subprocess, tempfile, threading, time, unittest, urllib.parse, types
if not hasattr(os, 'O_NONBLOCK'): os.O_NONBLOCK = 0
source = pathlib.Path(__file__).with_name('vibe99_bridge.py').read_text()
names = {'resolve','stat_file','image_path','read_file','list_dir','Terminal','dispatch','watchdog','terminate','terminate_owned','cleanup','cleanup_owned','emit','output_writer'}
module = ast.Module(body=[n for n in ast.parse(source).body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names],type_ignores=[])
ns = dict(base64=base64,os=os,stat=stat,urllib=urllib,threading=threading,time=time,MAX_TEXT=4*1024*1024,MAX_IMAGE=16*1024*1024)
exec(compile(module,'vibe99_bridge.py','exec'),ns)
class BridgeTests(unittest.TestCase):
    def test_binary_media_and_limits(self):
        with tempfile.TemporaryDirectory() as folder:
            p=pathlib.Path(folder)/'report.pdf'; data=b'%PDF-1.4\n\x00\xff'
            p.write_bytes(data)
            result=ns['read_file']({'path':str(p)},media=True)
            self.assertEqual(result['mime'],'application/pdf')
            self.assertEqual(base64.b64decode(result['data']),data)
            self.assertIn('stamp',result)
            p=pathlib.Path(folder)/'unsafe.svg';p.write_text('<svg/>')
            with self.assertRaises(ValueError): ns['read_file']({'path':str(p)},media=True)
            p=pathlib.Path(folder)/'large.pdf'
            with p.open('wb') as out: out.truncate(16*1024*1024+1)
            with self.assertRaises(ValueError): ns['read_file']({'path':str(p)},media=True)
    def setUp(self): self.original = dict(ns)
    def tearDown(self): ns.clear(); ns.update(self.original)
    def test_terminal_exit_cannot_overtake_queued_data(self):
        stop=threading.Event(); captured=[]
        def write(value):
            captured.append(json.loads(value))
            if len(captured)==4: stop.set()
        ns.update(queue=queue,json=json,stopping=stop,output_control=queue.Queue(64),
                  output_files=queue.Queue(2),output_terminal=queue.Queue(1024),output_ready=threading.Event(),
                  sys=types.SimpleNamespace(stdout=types.SimpleNamespace(write=write,flush=lambda:None)))
        for sequence in (1,2,3): ns['emit']({'event':'terminal-data','terminal':'t','sequence':sequence})
        ns['emit']({'event':'terminal-exit','terminal':'t'})
        ns['output_writer']()
        self.assertEqual([item['event'] for item in captured],['terminal-data']*3+['terminal-exit'])
        self.assertEqual([item['sequence'] for item in captured[:3]],[1,2,3])
    def test_watchdog_expires_independently_of_stdin(self):
        calls=[]
        class ExitForTest(Exception): pass
        def exit_for_test(code):
            calls.append(('exit',code))
            raise ExitForTest()
        ns.update(stopping=types.SimpleNamespace(wait=lambda seconds:False),
                  time=types.SimpleNamespace(monotonic=lambda:61),last_ping=0,
                  cleanup=lambda:calls.append('cleanup'),os=types.SimpleNamespace(_exit=exit_for_test))
        with self.assertRaises(ExitForTest): ns['watchdog']()
        self.assertEqual(calls,['cleanup',('exit',0)])
        waits=iter([False,True]);calls.clear()
        ns.update(stopping=types.SimpleNamespace(wait=lambda seconds:next(waits)),
                  time=types.SimpleNamespace(monotonic=lambda:59))
        ns['watchdog']();self.assertEqual(calls,[])
    def test_shutdown_escalates_only_owned_groups_once(self):
        calls=[]; waits=[]
        fake_signal=types.SimpleNamespace(SIGHUP=1,SIGKILL=9)
        class Process:
            pid=100
            def wait(self,timeout):
                waits.append(timeout)
                if timeout==1: raise subprocess.TimeoutExpired('owned',timeout)
        terminal=ns['Terminal']('owned',Process(),7)
        def proc_open(path):
            pid=int(path.split('/')[2]); session=100 if pid in (100,101) else 999
            return io.StringIO(f'{pid} (test) S 1 {pid} {session} 0')
        ns.update(signal=fake_signal,subprocess=subprocess,open=proc_open,
                  os=types.SimpleNamespace(tcgetpgrp=lambda fd:101,getpgrp=lambda:1,
                    listdir=lambda path:['100','101','900','self'],killpg=lambda pid,sig:calls.append((pid,sig))))
        workers=[threading.Thread(target=ns['terminate'],args=(terminal,)) for _ in range(2)]
        for worker in workers:worker.start()
        for worker in workers:worker.join(1)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(set(calls),{(100,1),(101,1),(100,9),(101,9)})
        self.assertEqual(len(calls),4);self.assertEqual(waits,[1,.5])
        self.assertTrue(terminal.cancelled)
    def test_concurrent_cleanup_waits_for_one_parallel_teardown(self):
        calls=[]
        def terminate(terminal):
            time.sleep(.05)
            calls.append(terminal)
        ns.update(stopping=threading.Event(),cleanup_lock=threading.Lock(),terminal_lock=threading.Lock(),
                  terminals={i:i for i in range(4)},terminate=terminate,session_dir='owned-session',
                  shutil=types.SimpleNamespace(rmtree=lambda path,ignore_errors:calls.append(path)))
        workers=[threading.Thread(target=ns['cleanup']) for _ in range(2)]
        started=time.monotonic()
        for worker in workers:worker.start()
        for worker in workers:worker.join(1)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertLess(time.monotonic()-started,.5)
        self.assertEqual(sorted(calls[:-1]),[0,1,2,3]);self.assertEqual(calls[-1],'owned-session')
    def test_blocked_file_stdout_does_not_block_ack_dispatch(self):
        entered=threading.Event();release=threading.Event();stop=threading.Event()
        def write(value): entered.set();release.wait(2)
        terminal=ns['Terminal']('t',None,0);terminal.sequence=1;terminal.pending={1:4096}
        ns.update(queue=queue,json=json,stopping=stop,output_control=queue.Queue(64),
                  output_files=queue.Queue(32),output_terminal=queue.Queue(1024),output_ready=threading.Event(),
                  sys=types.SimpleNamespace(stdout=types.SimpleNamespace(write=write,flush=lambda:None)),
                  terminal_lock=threading.Lock(),terminals={'t':terminal})
        ns['emit']({'id':1,'result':'file body'})
        worker=threading.Thread(target=ns['output_writer']);worker.start()
        try:
            self.assertTrue(entered.wait(1))
            started=time.monotonic()
            ns['dispatch']('terminal-ack',{'terminal':'t','sequence':1})
            ns['emit']({'id':2,'result':None},control=True)
            self.assertLess(time.monotonic()-started,.1)
            self.assertEqual(terminal.pending,{})
            self.assertEqual(ns['output_control'].qsize(),1)
        finally:
            stop.set();release.set();worker.join(1)
        self.assertFalse(worker.is_alive())

    def test_read_stat_image_and_pagination(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            note=root/'note.md'; note.write_text('hello',encoding='utf8')
            self.assertEqual(ns['read_file']({'path':str(note)})['text'],'hello')
            (root/'binary').write_bytes(b'\0')
            with self.assertRaises(ValueError): ns['read_file']({'path':str(root/'binary')})
            (root/'large').write_bytes(b'x'*(ns['MAX_TEXT']+1))
            with self.assertRaises(ValueError): ns['read_file']({'path':str(root/'large')})
            (root/'a b.png').write_bytes(b'png')
            image=ns['read_file']({'document':str(note),'root':folder,'source':'a%20b.png'},True)
            self.assertEqual(image['url'],'data:image/png;base64,cG5n')
            with self.assertRaises(ValueError): ns['image_path']({'source':'https://example.org/image.png'})
            for i in range(105): (root/str(i)).touch()
            self.assertEqual(ns['list_dir']({'path':folder})['next'],100)
    def test_ack_is_cumulative_and_bounded(self):
        terminal=ns['Terminal']('test',None,0)
        terminal.sequence=64; terminal.pending={i:4096 for i in range(1,65)}
        terminal.ack(32)
        self.assertEqual(len(terminal.pending),32)
        with self.assertRaises(ValueError): terminal.ack(65)
        terminal.cancel(); self.assertTrue(terminal.cancelled)
    def test_producer_stops_reads_until_consumption_ack(self):
        original = dict(ns)
        count = [0]
        def read(fd,size):
            count[0] += 1
            return b'x'*4096
        fake_os = types.SimpleNamespace(read=read,close=lambda fd:None)
        ns.update(os=fake_os,select=types.SimpleNamespace(select=lambda *args:([1],[],[])),
                  stopping=threading.Event(),emit=lambda value:None,terminate=lambda terminal:None,
                  terminal_lock=threading.Lock(),terminals={})
        terminal=ns['Terminal']('test',types.SimpleNamespace(poll=lambda:0),1)
        worker=threading.Thread(target=terminal.output)
        try:
            worker.start()
            deadline=time.monotonic()+2
            while count[0]<64 and time.monotonic()<deadline: time.sleep(.005)
            self.assertEqual(count[0],64)
            time.sleep(.05)
            self.assertEqual(count[0],64)
            terminal.ack(32)
            deadline=time.monotonic()+2
            while count[0]<96 and time.monotonic()<deadline: time.sleep(.005)
            self.assertEqual(count[0],96)
            terminal.cancel()
            worker.join(1)
            self.assertFalse(worker.is_alive())
        finally:
            terminal.cancel()
            worker.join(1)
            ns.clear(); ns.update(original)
    def test_unknown_write_methods_are_rejected(self):
        for method in ('save','upload-start','project-settings','fs-operation'):
            with self.assertRaises(ValueError): ns['dispatch'](method,{})
if __name__=='__main__': unittest.main()

