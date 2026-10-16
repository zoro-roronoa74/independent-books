"""Local-only runtime; no Tally executable, remote service or AI dependency."""
import copy
import datetime as dt
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import xml.etree.ElementTree as ET
from books import Books, KINDS, InventoryWarning
from interchange import _xml_safe_text, apply_import, preview_import, export_xml, generate_sample_template, bulk_import_masters

ROOT=Path(__file__).parent
PAYLOAD_KEYS={'stock_item':'item','group':'group','unit':'unit','godown':'godown','voucher_type':'voucher_type',
              'stock_group':'stock_group','stock_category':'stock_category','cost_category':'category',
              'cost_centre':'centre','currency':'currency','ledger':'ledger'}


class StorageLock:
    """Only one server may own a books file; separate snapshots cannot safely write it."""
    def __init__(self, path):
        lock_path = Path(str(path) + '.lock')
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.file = lock_path.open('a+b')
        if lock_path.stat().st_size == 0:
            self.file.write(b'0'); self.file.flush()
        self.file.seek(0)
        try:
            if __import__('os').name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            raise ValueError('These books are already open in another application server') from error

    def close(self):
        self.file.close()


class BooksServer(ThreadingHTTPServer):
    def server_close(self):
        super().server_close()
        if hasattr(self, 'db'): self.db.connection.close()
        if hasattr(self, 'storage_lock'): self.storage_lock.close()


def data_view(db,company=None,start=None,end=None):
    c=db.view(company,start,end)
    today=dt.datetime.now().date()
    return {'active_company':c.get('name',''),'company_meta':{k:v for k,v in c.items() if k not in ('vouchers','all_vouchers','ledgers','stock_items','source_imports')},
            'companies':db.get_companies_list(),'current_date':today.strftime('%d-%b-%Y'),
            'current_date_iso':today.isoformat(),
            'fy_period':c.get('starting_from','')+' to '+c.get('ending_at',''),
            'from_date':c.get('from_date',''),'to_date':c.get('to_date',''),
            'last_entry_date':max((v['DATE'] for v in c.get('all_vouchers',[])),default=''),
            'revision':db.data['revision'],**{field:c.get(field,{} if field in ('ledgers','stock_items') else []) for field in KINDS.values()},
            'vouchers':c.get('vouchers',[]),'bills_receivable':c.get('bills_receivable',[]),'bills_payable':c.get('bills_payable',[]),
            'next_numbers':{t:db.next_number(db.get_company(c['name']),t) for t in c.get('voucher_types',[])} if c else {},
            'group_records':c.get('group_records',{}), 'master_records':{k:c.get(k+'_records',{}) for k in KINDS}}


def make_server(port=3543,data_path=None,allow_lan=False):
    if data_path: data_path = str(data_path).strip('\"\'')
    path = Path(data_path or ROOT/'data'/'books.sqlite3').resolve()
    storage_lock = StorageLock(path)
    try:
        db=Books(str(path))
    except Exception:
        storage_lock.close()
        raise
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def send(self,data,status=200,content_type='application/json; charset=utf-8',headers=None):
            body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf-8') if isinstance(data,(dict,list)) else data.encode('utf-8') if isinstance(data,str) else data
            self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
            if headers:
                for k,v in headers.items(): self.send_header(k,v)
            self.end_headers();self.wfile.write(body)
        def do_GET(self):
            try:
                if self.headers.get('Host','') not in ('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port)):
                    return self.send({'error':'Invalid local host'},403)
                parsed=urlparse(self.path);query={k:v[0] for k,v in parse_qs(parsed.query).items()}
                with db.lock:
                    if parsed.path=='/api/data': return self.send(data_view(db,query.get('company'),query.get('from'),query.get('to')))
                    if parsed.path=='/api/status': return self.send({'status':'online','independent':True,'companies':len(db.data['companies']),'application_root':str(ROOT.resolve()),'data_path':str(path)})
                    if parsed.path=='/api/check_update':
                        return self.send({
                            'status': 'success',
                            'current_version': '1.0.0',
                            'latest_version': '1.0.0',
                            'update_available': False,
                            'changelog': 'Independent Books is up-to-date (v1.0.0, air-gapped local build).',
                            'release_url': 'https://github.com/independentbooks/releases'
                        })
                    if parsed.path=='/api/last_narration':
                        company=query.get('company')
                        voucher_type=query.get('voucher_type')
                        if not company or not voucher_type: raise ValueError('Company and voucher_type are required')
                        return self.send({'status':'success','narration':db.last_narration(company,voucher_type,query.get('exclude'))})
                    if parsed.path=='/api/pending_bills':
                        company=query.get('company') or db.get_active_company_name()
                        if not company: raise ValueError('Company is required')
                        return self.send({'status':'success','revision':db.data['revision'],
                                          'bills':db.pending_bills(company, query.get('ledger'),
                                                                   query.get('as_of'), query.get('exclude'))})
                    if parsed.path=='/api/ageing':
                        company=query.get('company') or db.get_active_company_name()
                        if not company: raise ValueError('Company is required')
                        return self.send({'status':'success','revision':db.data['revision'],
                                          'report':db.ageing(company, query.get('ledger'), query.get('as_of'),
                                                             query.get('basis','due_date'))})
                    if parsed.path=='/api/financial_tree':
                        company=query.get('company') or db.get_active_company_name()
                        period={'id':query.get('period_id','period'), 'from':query.get('from'),
                                'to':query.get('to'), 'label':query.get('label','')}
                        snapshot=db.financial_tree(company, query.get('report','Balance Sheet'), period,
                                                  query.get('detailed','0') in ('1','true','yes'))
                        return self.send({'status':'success','snapshot':snapshot})
                    if parsed.path=='/api/compare_periods':
                        company=query.get('company') or db.get_active_company_name()
                        periods=json.loads(query.get('periods','[]'))
                        comparison=db.compare_periods(company, query.get('report','Balance Sheet'), periods)
                        return self.send({'status':'success','comparison':comparison})
                    if parsed.path=='/api/dashboard_metrics':
                        company=query.get('company') or db.get_active_company_name()
                        if not company: raise ValueError('Company is required')
                        date=query.get('date')
                        metrics=db.get_dashboard_metrics(company, date=date)
                        return self.send({'status':'ok','metrics':metrics})
                    if parsed.path=='/api/billing_profiles':
                        company=query.get('company') or db.get_active_company_name()
                        if not company: raise ValueError('Company is required')
                        return self.send({'status':'success','revision':db.data['revision'],
                                          'profiles':db.billing_profiles(company)})
                    if parsed.path=='/api/export': return self.send(copy.deepcopy(db.data))
                    if parsed.path=='/api/export_xml': return self.send(export_xml(db.get_company(query.get('company'))),content_type='application/xml; charset=utf-8')
                    if parsed.path=='/api/sample_template':
                        tmpl_type=query.get('type','ledgers');fmt=query.get('format','csv')
                        data=generate_sample_template(tmpl_type,fmt)
                        ct='text/csv; charset=utf-8' if fmt.lower()=='csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        filename=f"sample_bulk_{tmpl_type}.{fmt.lower()}"
                        return self.send(data,content_type=ct,headers={'Content-Disposition':f'attachment; filename="{filename}"'})
                paths={'/':'index.html','/fidelity.css':'fidelity.css','/voucher_logic.js':'voucher_logic.js','/date_picker.js':'date_picker.js','/print_view.js':'print_view.js','/lookup_context.js':'lookup_context.js','/workflows.js':'workflows.js','/logo.png':'logo.png','/favicon.ico':'favicon.ico','/app.ico':'app.ico','/manifest.json':'manifest.json'}
                if parsed.path not in paths: return self.send({'error':'Not found'},404)
                file=ROOT/paths[parsed.path]
                mime=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
                if file.suffix in ('.html','.css','.js'): mime+='; charset=utf-8'
                return self.send(file.read_bytes(),content_type=mime)
            except Exception as error: self.send({'status':'error','error':str(error)},400)
        def do_POST(self):
            try:
                if not getattr(self.server, 'allow_lan', False):
                    if self.headers.get('Host','') not in ('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port)):
                        return self.send({'error':'Invalid local host'},403)
                    origin=self.headers.get('Origin')
                    if origin and origin not in ('http://127.0.0.1:'+str(self.server.server_port),'http://localhost:'+str(self.server.server_port)):
                        return self.send({'error':'Cross-origin writes are not permitted'},403)
                length=int(self.headers.get('Content-Length',0))
                if length<1 or length>32*1024*1024: return self.send({'error':'Request size must be 1 byte to 32 MiB'},413)
                raw=self.rfile.read(length).decode('utf-8');path=urlparse(self.path).path
                if path=='/' and raw.lstrip().startswith('<'):
                    root=ET.fromstring(_xml_safe_text(raw));request=root.findtext('.//TALLYREQUEST','')
                    company=root.findtext('.//SVCURRENTCOMPANY')
                    if 'import' in request.lower(): result=apply_import(db,{'xml':raw,'company':company})
                    elif 'export' in request.lower(): return self.send(export_xml(db.get_company(company)),content_type='application/xml; charset=utf-8')
                    else: raise ValueError('Unsupported XML request')
                    return self.send('<RESPONSE><CREATED>'+str(result['vouchers'])+'</CREATED><ERRORS>0</ERRORS></RESPONSE>',content_type='application/xml; charset=utf-8')
                payload=json.loads(raw);company=payload.get('company')
                if path=='/api/shutdown':
                    if payload.get('application_root')!=str(ROOT.resolve()): return self.send({'error':'Application identity does not match'},403)
                    self.send({'status':'success'})
                    threading.Thread(target=self.server.shutdown,daemon=True).start()
                    return
                if path=='/api/save_company':
                    if payload.get('operation')=='Create' and payload['company_meta'].get('name') in db.data['companies']: raise ValueError('Company name already exists')
                    db.create_or_alter_company(payload['company_meta']);result={}
                elif path=='/api/delete_company':
                    target = payload.get('company') or (payload.get('company_meta') or {}).get('name')
                    if not target: raise ValueError('Company name is required')
                    db.delete_company(target)
                    result={'active_company': db.get_active_company_name(), 'companies': list(db.data['companies'].keys())}
                elif path=='/api/billing_profiles':
                    if not company: raise ValueError('Explicit company is required')
                    result={'profiles':db.save_billing_profiles(company, payload.get('profiles'),
                        payload.get('expected_revision')),'revision':db.data['revision']}
                elif path=='/api/set_company': db.set_active_company_name(company);result={'active_company':company}
                elif path in ('/api/create_voucher','/api/alter_voucher'):
                    if not company: raise ValueError('Explicit company is required')
                    v=payload['voucher'];v['@ACTION']='Alter' if path.endswith('alter_voucher') else 'Create'
                    result={'voucher_id':db.post_voucher(
                        company, v, payload.get('expected_revision'),
                        payload.get('allow_inventory_warning', False), payload.get('warning_token'))}
                elif path in ('/api/preview_allocations','/api/allocate_bills'):
                    if not company: raise ValueError('Explicit company is required')
                    if 'ledger' not in payload or 'amount' not in payload or 'method' not in payload:
                        raise ValueError('Company, ledger, amount and method are required')
                    result={'allocation':db.allocate_bill_lines(
                        company, payload['ledger'], payload['amount'], payload['method'],
                        payload.get('allocations') or [], payload.get('expected_revision', db.data['revision']),
                        commit=path.endswith('allocate_bills')),
                        'revision':db.data['revision']}
                elif path=='/api/preview_inventory':
                    if not company: raise ValueError('Explicit company is required')
                    inventory=db.preview_inventory_posting(company,payload['voucher'])
                    if inventory.get('errors'):
                        return self.send({'status':'error','error':'Inventory policy blocks this posting',
                                          'inventory':inventory,'revision':db.data['revision']},409)
                    result={'inventory':inventory,'revision':db.data['revision']}
                elif path in ('/api/delete_voucher','/api/cancel_voucher'):
                    if not company: raise ValueError('Explicit company is required')
                    if not db.cancel_or_delete_voucher(company,payload.get('voucher_id') or payload.get('voucher_number'),path.endswith('delete_voucher')): raise ValueError('Voucher not found')
                    result={}
                elif path.startswith('/api/save_') and path[10:] in KINDS:
                    if not company: raise ValueError('Explicit company is required')
                    kind=path[10:];record=payload.get(PAYLOAD_KEYS[kind]) or payload.get('record')
                    if not isinstance(record,dict): raise ValueError('Master record is required')
                    if payload.get('operation')=='Create' and record.get('name') in db.get_company(company)[KINDS[kind]]: raise ValueError('Master name already exists')
                    result={'is_new':db.save_master(company,kind,record)}
                elif path=='/api/bulk_import':
                    if not company: raise ValueError('Explicit company is required')
                    res=bulk_import_masters(db,company,payload.get('type','ledgers'),payload.get('content',''),payload.get('format','csv'))
                    result=res
                elif path=='/api/bulk_update_rates':
                    if not company: raise ValueError('Explicit company is required')
                    result={'updated':db.bulk_update_item_rates(company,payload.get('items',[]))}
                elif path=='/api/import_preview': result=preview_import(db,payload)
                elif path in ('/api/import','/api/restore'): result=apply_import(db,payload)
                else: return self.send({'status':'error','error':'Unknown endpoint'},404)
                self.send({'status':'success',**result})
            except InventoryWarning as error:
                self.send({'status':'error','error':str(error),
                           'inventory':{'warnings':error.warnings,'warning_token':error.token}},409)
            except (ValueError,KeyError,TypeError,ET.ParseError) as error:
                status=409 if str(error).lower().startswith('stale') else 400
                self.send({'status':'error','error':str(error)},status)
            except Exception as error: self.send({'status':'error','error':'Operation failed; no save confirmation. '+str(error)},500)
    try:
        host = '0.0.0.0' if allow_lan else '127.0.0.1'
        server=BooksServer((host,port),Handler)
    except Exception:
        db.connection.close(); storage_lock.close()
        raise
    server.db=db; server.storage_lock=storage_lock
    server.allow_lan=allow_lan
    return server


if __name__=='__main__':
    import argparse, socket
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=3543)
    parser.add_argument('--data')
    parser.add_argument('--lan',action='store_true',help='Allow mobile / Android devices on the same Wi-Fi network')
    args=parser.parse_args()
    server=make_server(args.port,args.data,allow_lan=args.lan)
    print(f'Independent application (Air-gapped localhost): http://127.0.0.1:{server.server_port}',flush=True)
    if args.lan:
        try:
            s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
            s.connect(('8.8.8.8',80))
            local_ip=s.getsockname()[0]
            s.close()
        except Exception:
            local_ip='0.0.0.0'
        print(f'📱 Mobile / Android access on same Wi-Fi: http://{local_ip}:{server.server_port}',flush=True)
    try: server.serve_forever()
    finally: server.server_close();server.db.connection.close()
