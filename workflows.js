'use strict';
// One route stack serves menus, reports, masters and voucher drill-downs.
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const state = {data:null, stack:[{kind:'gateway',cursor:0}], period:{}, dialog:null, draft:null, lookup:null, busy:false};
const voucherRules = window.IndependentVoucherRules || {};
const frame = () => state.stack.at(-1);
const kinds = {ledger:'Ledgers',group:'Groups',stock_item:'Stock Items',unit:'Units',godown:'Godowns',voucher_type:'Voucher Types',stock_group:'Stock Groups',stock_category:'Stock Categories',cost_category:'Cost Categories',cost_centre:'Cost Centres',currency:'Currencies'};
const fields = {ledger:'ledgers',group:'groups',stock_item:'stock_items',unit:'units',godown:'godowns',voucher_type:'voucher_types',stock_group:'stock_groups',stock_category:'stock_categories',cost_category:'cost_categories',cost_centre:'cost_centres',currency:'currencies'};
const nonAccounting = new Set(['Sales Order','Purchase Order','Delivery Note','Receipt Note','Rejections In','Rejections Out','Stock Journal','Physical Stock']);
const listOf = (v,key='ALLLEDGERENTRIES.LIST') => {const result=v[key] || (key==='ALLLEDGERENTRIES.LIST'?v['LEDGERENTRIES.LIST']:null) || [];return Array.isArray(result)?result:[result];};
const active = v => !['CANCELLED','ISCANCELLED','ISOPTIONAL'].some(k=>String(v[k]||'No').toLowerCase()==='yes');
function cents(value) {const s=voucherRules.parseTallyAmount(value);const sign=s.startsWith('-')?-1n:1n;const [a,b='']=s.replace('-','').split('.');return sign*(BigInt(a)*100n+BigInt(b.padEnd(2,'0')));}
const decimalMoney = value => {value=BigInt(value);const sign=value<0n?'-':'';value=value<0n?-value:value;return sign+(value/100n)+'.'+String(value%100n).padStart(2,'0');};
function money(value) {const signed=BigInt(value);const s=decimalMoney(signed<0n?-signed:signed);const [whole,part]=s.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+part;}
const signedEntry = e => String(e.ISDEEMEDPOSITIVE||'').toLowerCase()==='yes'?abs(cents(e.AMOUNT)):String(e.ISDEEMEDPOSITIVE||'').toLowerCase()==='no'?-abs(cents(e.AMOUNT)):-cents(e.AMOUNT);
const abs = x => x<0n?-x:x;
const amountOf = v => listOf(v).reduce((sum,e)=>{const n=signedEntry(e);return n>0n?sum+n:sum;},0n);
function shownDate(value) {const s=String(value||'');if(!/^\d{8}$/.test(s))return s;return `${Number(s.slice(6))}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(s.slice(4,6))-1]}-${s.slice(2,4)}`;}
function inputDate(value) {const s=String(value||'');return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:s;}
function keyDate(value) {if(/^\d{8}$/.test(value))return value;return String(value).replaceAll('-','');}
function date_key_ui(value) {const text=String(value||'').trim();if(/^\d{8}$/.test(text))return text;return text.replaceAll('-','');}
async function api(path,payload) {const result=await fetch(path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await result.json();if(!result.ok||body.status==='error'){const err=new Error(body.error||'The operation failed');err.data=body;err.status=result.status;throw err;}return body;}
async function refresh() {const query=new URLSearchParams(state.period);state.data=await api('/api/data?'+query);}
function note(message,error=false) {$('#status').textContent=message;$('#status').style.color=error?'#a00':'';}
function navigate(next) {closeVoucherLookup();captureForm();frame().scroll=$('#screen').scrollTop;state.stack.push({...next,cursor:0});state.draft=null;render();}
function back() {closeVoucherLookup();if(state.dialog)return closeDialog();if(state.stack.length===1)return action('quit');if(state.draft?.dirty)return confirmBox('Quit without saving?',()=>{state.draft=null;pop();});pop();}
function pop() {closeVoucherLookup();if(state.stack.length>1)state.stack.pop();state.draft=null;render();}
function requireCompany() {if(state.data.active_company)return true;companyDialog();return false;}
function rowButton(label,action,args='',selected=false,extra='') {return `<button class="menu-row ${selected?'selected':''} ${extra}" data-row data-action="${action}" data-args="${esc(args)}">${frame().kind==='gateway'?gatewayCaption(label):esc(label)}</button>`;}
function gatewayCaption(label) {const keys={Create:'C',Alter:'A','Chart of Accounts':'H',Vouchers:'V','Day Book':'K',Banking:'N','Balance Sheet':'B','Profit & Loss A/c':'P','Stock Summary':'S','Ratio Analysis':'R','Display More Reports':'D',Dashboard:'O',Quit:'Q'};const key=keys[label],at=key?label.toUpperCase().indexOf(key):-1;return at<0?esc(label):esc(label.slice(0,at))+`<span class="menu-hotkey">${esc(['Day Book','Banking','Dashboard'].includes(label)?key:label[at])}</span>`+esc(label.slice(at+1));}
function lookupPanelHtml() {
  const lookup=state.lookup;
  if(frame().kind!=='voucher'||!lookup)return '';
  const options=(lookup.options||[]).filter(o=>!o.isCreate&&!o.isBlank);
  const rows=options.map((option,index)=>`<button type="button" class="lookup-option ${index===(lookup.cursor-2)?'selected':''}" data-lookup-value="${esc(option.value)}"><span>${esc(option.name)}</span><small>${esc(option.detail||'')}</small></button>`).join('');
  const creates=(lookup.context?.createOptions||[]).map((option,index)=>`<button type="button" class="lookup-create" data-action="lookupCreate" data-args="${index}">${esc(option.label)}</button>`).join('');
  return `<section class="voucher-lookup-panel" aria-label="${esc(lookup.context.title)}"><div class="lookup-title">${esc(lookup.context.title)}</div><input id="voucher-lookup-search" class="lookup-search" aria-label="Search ${esc(lookup.context.title)}" autocomplete="off" value="${esc(lookup.query||'')}"><div class="lookup-list" role="listbox">${rows||'<div class="lookup-empty">No matching choices</div>'}</div><div class="lookup-create-list">${creates}</div></section>`;
}
const SVG_ICONS = {
  F12: '<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  F2: '<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  P: '<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  'Ctrl+P': '<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  E: '<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
};
const SVG_GATEWAY = {
  calendar: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  building: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/></svg>',
  cart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  wallet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  truck: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  trend: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
};
function getSvgIcon(shortcut) {return SVG_ICONS[shortcut]||'';}
function setKeys(items) {if(items)state.keys=items;const keys=state.keys||[];$('#keys').innerHTML=lookupPanelHtml()+keys.map(item=>item==='gap'?'<div class="gap"></div>':`<button data-shortcut="${esc(item[0])}" data-action="${item[2]}" data-args="${esc(item[3]||'')}">${getSvgIcon(item[0])}<span>${esc(item[0])}:</span> ${esc(item[1])}<em>‹</em></button>`).join('')+'<div class="bottom"></div>';}
function isVoucherLookupControl(control) {return Boolean(control&&frame().kind==='voucher'&&['party','account','payment_bank','ledger','item'].includes(control.name));}
function lookupRowType(control) {return control?.name==='item'?'item':control?.closest('#extra-table')?'extra':'';}
function lookupContextFor(control) {
  const helper=window.IndependentLookupContext;
  if(!helper||!state.draft||!isVoucherLookupControl(control))return null;
  return helper.lookupContext(state.data,{base:state.draft.base,field:control.name,rowType:lookupRowType(control),selected:control.value,accountName:state.draft.accountName||$('#edit-form [name=account]')?.value||'',partyName:$('#edit-form [name=party]')?.value||''});
}
function lookupOptionsFor(context,query='') {return window.IndependentLookupContext.lookupOptions(state.data,context,query);}
function renderFloatingDropdown() {
  let el = document.getElementById('floating-lookup-dropdown');
  if(!state.lookup || !state.lookup.control || !state.lookup.control.isConnected || frame().kind !== 'voucher') {
    document.querySelectorAll('.floating-dropdown, #floating-lookup-dropdown').forEach(e => e.remove());
    return;
  }
  if(!el) {
    el = document.createElement('div');
    el.id = 'floating-lookup-dropdown';
    el.className = 'floating-dropdown';
    document.body.appendChild(el);
  }
  const rect = state.lookup.control.getBoundingClientRect();
  el.style.position = 'fixed';
  el.style.left = Math.max(10, rect.left) + 'px';
  el.style.top = (rect.bottom + 4) + 'px';
  el.style.width = Math.max(280, rect.width) + 'px';
  el.style.zIndex = '1000';

  const options = state.lookup.options || [];
  const rows = options.map((opt, i) => `
    <div class="floating-option ${opt.isCreate ? 'create-option' : ''} ${opt.isBlank ? 'blank-option' : ''} ${i === state.lookup.cursor ? 'selected' : ''}" data-lookup-value="${esc(opt.value)}">
      <span class="opt-name ${opt.isBlank ? 'opt-blank' : ''}">${esc(opt.name)}</span>
      <small class="opt-detail">${esc(opt.detail || '')}</small>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="floating-title">
      <span>${esc(state.lookup.context?.title || 'List of Choices')}</span>
      ${state.lookup.query ? `<span class="floating-query">"${esc(state.lookup.query)}"</span>` : ''}
    </div>
    <div class="floating-list" role="listbox">
      ${rows || '<div class="lookup-empty">No matching choices</div>'}
    </div>
  `;
  const selectedRow = el.querySelector('.floating-option.selected');
  if(selectedRow) selectedRow.scrollIntoView({block: 'nearest'});
}

function buildVoucherDropdownOptions(context, query = '') {
  const matched = lookupOptionsFor(context, query);
  const isItem = context.field === 'item';
  const createTitle = isItem ? '+ Create Stock Item' : '+ Create Ledger';
  return [
    { name: createTitle, value: '__create__', isCreate: true, detail: 'Alt+C' },
    { name: '\u00A0', value: '__blank__', isBlank: true, detail: 'Enter: skip' },
    ...matched
  ];
}

function focusVoucherLookup(control,{render=true}={}) {
  const context=lookupContextFor(control);
  if(!context)return false;
  const options=buildVoucherDropdownOptions(context,'');
  let cursor = 1;
  if(control.value) {
    const idx = options.findIndex(option=>option.value===control.value);
    if(idx >= 0) cursor = idx;
  }
  state.lookup={control,context,query:'',options,cursor};
  if(render)setKeys();
  renderFloatingDropdown();
  return true;
}

function refreshVoucherLookup(query=state.lookup?.query||'') {
  if(!state.lookup)return;
  const searching=document.activeElement?.id==='voucher-lookup-search';
  state.lookup.query=query;
  const options=buildVoucherDropdownOptions(state.lookup.context,query);
  state.lookup.options=options;
  if(query.trim()) {
    state.lookup.cursor = options.length > 2 ? 2 : (options.length > 0 ? 0 : 1);
  } else {
    state.lookup.cursor = 1;
  }
  setKeys();
  renderFloatingDropdown();
  if(searching){const input=$('#voucher-lookup-search');input?.focus();if(input)input.setSelectionRange(input.value.length,input.value.length);}
}

function closeVoucherLookup() {
  if(!state.lookup)return;
  state.lookup=null;
  const panel=$('#keys .voucher-lookup-panel');
  if(panel)panel.remove();
  document.querySelectorAll('.floating-dropdown, #floating-lookup-dropdown').forEach(e => e.remove());
}

function selectVoucherLookup(value,advance=true) {
  const lookup=state.lookup,control=lookup?.control;
  if(!lookup||!control?.isConnected)return;
  if(value === '__create__') {
    const createOption = lookup.context?.createOptions?.[0] || lookup.context?.create;
    closeVoucherLookup();
    return openInlineMaster(control, true, createOption);
  }
  if(value === '__blank__') {
    closeVoucherLookup();
    control.value = '';
    if(control.name === 'item') {
      const extra = $('#extra-table [name=ledger]');
      if(extra) { extra.focus(); return; }
      if(ensureExtraLedgerRow()) return;
    } else if(control.name === 'ledger' && control.closest('#extra-table')) {
      const narration = $('#edit-form [name=narration]');
      if(narration) { narration.focus(); return; }
    }
    if(advance) return focusNextControl(control);
    return;
  }
  if(control.tagName==='SELECT' && !Array.from(control.options).some(o=>o.value===value)){
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    control.appendChild(opt);
  }
  control.value=value;
  closeVoucherLookup();
  control.dispatchEvent(new Event('change',{bubbles:true}));
  if(!state.dialog){
    control.focus();
    if(advance)focusNextControl(control);
  }
}

function moveLookupCursor(delta) {
  if(!state.lookup?.options?.length) return;
  const len = state.lookup.options.length;
  state.lookup.cursor = (state.lookup.cursor + delta + len) % len;
  renderFloatingDropdown();
  const panel = document.querySelector('.voucher-lookup-panel');
  if(panel) {
    const list = panel.querySelector('.lookup-list');
    if(list) {
      const options = (state.lookup.options || []).filter(o => !o.isCreate && !o.isBlank);
      list.innerHTML = options.map((option, index) => `<button type="button" class="lookup-option ${index === (state.lookup.cursor - 2) ? 'selected' : ''}" data-lookup-value="${esc(option.value)}"><span>${esc(option.name)}</span><small>${esc(option.detail || '')}</small></button>`).join('') || '<div class="lookup-empty">No matching choices</div>';
      const sel = list.querySelector('.lookup-option.selected');
      if(sel) sel.scrollIntoView({block: 'nearest'});
    }
  }
  setKeys();
}

function selectLookupCursor() {
  const option=state.lookup?.options?.[state.lookup.cursor];
  if(option) selectVoucherLookup(option.value);
}

function ensureExtraLedgerAddButton() {const table=$('#extra-table');if(!table||table.nextElementSibling?.matches('[data-action="addLine"][data-args="extra"]'))return;table.insertAdjacentHTML('afterend','<button type="button" class="add-line" data-action="addLine" data-args="extra">Add Ledger Row</button>');}
function standardKeys() {return [['F2','Period','period'],['F3','Company','company'],'gap',['F4','Contra','voucher','Contra'],['F5','Payment','voucher','Payment'],['F6','Receipt','voucher','Receipt'],['F7','Journal','voucher','Journal'],['F8','Sales','voucher','Sales'],['F9','Purchase','voucher','Purchase'],['F10','Other Vouchers','types'],'gap',['C','Create','create'],['A','Alter','alter'],['H','Change View','view'],'gap',['B','Basis of Values','basis'],['F12','Setting','unifiedSettings']];}
function render() {
 if(!state.data)return;
 const f=frame();document.body.dataset.family=f.kind;
 if(f.kind!=='voucher')closeVoucherLookup();
 $('#company-title').textContent=state.data.active_company;
 $('#screen').className='';$('#screen').innerHTML='';$('#title').textContent='Gateway of Books';setKeys(standardKeys());
  const routes={gateway:renderGateway,menu:renderMenu,masters:renderMasters,master:renderMaster,companyForm:renderCompanyForm,report:renderReport,comparison:renderComparison,ageing:renderAgeing,voucher:renderVoucher,dashboard:renderDashboard,rates_manager:renderItemRatesManager};
  (routes[f.kind]||renderGateway)(f);
  if(f.kind==='voucher'&&state.draft?.base==='Receipt')upgradeReceiptVoucher();
  if(f.kind==='voucher')ensureExtraLedgerAddButton();
 if(f.savedForm){$('#screen').innerHTML=f.savedForm;state.draft=clone(f.savedDraft);refreshSelects();}
 if(f.kind==='voucher'){
  if(!$('#voucher-mode'))$('.voucher-band')?.insertAdjacentHTML('afterbegin','<span id="voucher-mode" class="voucher-mode"></span>');
  if($('#voucher-mode'))$('#voucher-mode').textContent=modeLabel(f.mode||state.draft?.mode||'voucher');
  if(!f.existing?.MASTERID)$('#title').textContent=(nonAccounting.has(f.vtype)?'Inventory':'Accounting')+' Voucher Creation';
 }
 if(f.inlineReturn){
  const target=f.inlineReturn;delete f.inlineReturn;
  const select=Array.from(document.querySelectorAll('#edit-form [name="'+target.field+'"]'))[target.index];
  if(select){
   if(target.created){select.value=target.created;select.dispatchEvent(new Event('change',{bubbles:true}));}
   select.focus();
    if(target.lookup)focusVoucherLookup(select);
  }
 }
 selectRow(f.cursor||0);$('#screen').scrollTop=f.scroll||0;
 if(!['voucher','master','companyForm'].includes(f.kind))$('#screen').focus({preventScroll:true});
}
function renderTrendSvg(points=[], activeSpan='week') {
  if(!points || !points.length) {
    return `<svg viewBox="0 0 320 80" style="width:100%;height:100%;">
      <g fill="#b7cfb9" opacity="0.6">
        <rect x="146" y="22" width="5" height="16" rx="2.5"/>
        <rect x="155" y="14" width="5" height="24" rx="2.5"/>
        <rect x="164" y="20" width="5" height="18" rx="2.5"/>
      </g>
      <text x="160" y="54" text-anchor="middle" font-size="11" fill="#607c65" font-weight="500">No sales data</text>
    </svg>`;
  }
  const maxVal = Math.max(...points.map(p => Math.abs(parseFloat(p.amount || 0))), 1);
  const w = 320, h = 60, pad = 25;
  const step = points.length > 1 ? (w - 2 * pad) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - (Math.max(0, parseFloat(p.amount || 0)) / maxVal) * (h - 20) - 10;
    return {x, y, label: p.label || '', amount: p.amount || '0'};
  });
  const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
  const dots = coords.map(c => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="#235c35" />`).join('');
  const labels = coords.map(c => `<text x="${c.x}" y="${h + 15}" font-size="9" fill="#48674f" text-anchor="middle">${esc(c.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h + 20}">
    <polyline points="${polylinePoints}" fill="none" stroke="#235c35" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${labels}
  </svg>`;
}

async function loadGatewayDashboard() {
  if(!state.data.active_company) return;
  try {
    const query = new URLSearchParams({company: state.data.active_company, date: state.workingDate || ''});
    const res = await api('/api/dashboard_metrics?' + query);
    if(res && res.metrics) {
      state.dashboardMetrics = res.metrics;
      updateGatewayDashboardUI();
    }
  } catch(e) {}
}

function updateGatewayDashboardUI() {
  const m = state.dashboardMetrics;
  if(!m) return;
  const salesEl = document.querySelector('[data-kpi="today_sales"] .kpi-value');
  const salesSub = document.querySelector('[data-kpi="today_sales"] .kpi-sub');
  if(salesEl) salesEl.textContent = money(cents(m.today_sales?.amount || 0));
  if(salesSub) salesSub.textContent = `${m.today_sales?.count || 0} invoice(s)`;

  const collEl = document.querySelector('[data-kpi="today_collections"] .kpi-value');
  if(collEl) collEl.textContent = money(cents(m.today_collections || 0));

  const custEl = document.querySelector('[data-kpi="due_from_customers"] .kpi-value');
  if(custEl) custEl.textContent = money(cents(m.due_from_customers || 0));

  const suppEl = document.querySelector('[data-kpi="due_to_suppliers"] .kpi-value');
  if(suppEl) suppEl.textContent = money(cents(m.due_to_suppliers || 0));

  const profEl = document.querySelector('[data-kpi="month_profit"] .kpi-value');
  if(profEl) profEl.textContent = money(cents(m.month_profit || 0));

  const span = state.activeTrendSpan || 'week';
  const chartEl = document.querySelector('.trend-chart');
  if(chartEl && m.trend) {
    chartEl.innerHTML = renderTrendSvg(m.trend[span] || [], span);
  }
}

function renderGateway() {
  const d=state.data;
  $('#company-title').textContent='';
  setKeys([['F2','Date','date'],['F3','Company','company'],['F12','Setting','unifiedSettings']]);
  const activeSpan = state.activeTrendSpan || 'week';
  const m = state.dashboardMetrics || {};
  const todaySales = m.today_sales || {amount: '0.00', count: 0};
  const trendData = m.trend?.[activeSpan] || [];

  $('#screen').innerHTML=`<div class="gateway">
    <section class="company-info gateway-left-panel">
      <div class="gateway-info-grid">
        <div class="gateway-info-tile">
          <div class="info-tile-icon">${SVG_GATEWAY.calendar}</div>
          <div class="info-tile-content">
            <small class="info-tile-label">CURRENT PERIOD</small>
            <strong class="info-tile-value">${d.from_date&&d.to_date?esc(shownDate(d.from_date))+' to '+esc(shownDate(d.to_date)):''}</strong>
          </div>
        </div>
        <div class="gateway-info-tile">
          <div class="info-tile-icon">${SVG_GATEWAY.calendar}</div>
          <div class="info-tile-content">
            <small class="info-tile-label">CURRENT DATE</small>
            <strong class="info-tile-value">${esc(currentDateText(state.workingDate||d.current_date_iso))}</strong>
          </div>
        </div>
        <div class="gateway-info-tile">
          <div class="info-tile-icon">${SVG_GATEWAY.building}</div>
          <div class="info-tile-content">
            <small class="info-tile-label">NAME OF COMPANY</small>
            ${d.active_company?`<button type="button" class="info-company-btn" data-action="company"><strong>${esc(d.active_company)}</strong></button>`:'<button type="button" class="info-company-btn" data-action="companyForm"><strong>Select / Create Company</strong></button>'}
          </div>
        </div>
        <div class="gateway-info-tile">
          <div class="info-tile-icon">${SVG_GATEWAY.calendar}</div>
          <div class="info-tile-content">
            <small class="info-tile-label">DATE OF LAST ENTRY</small>
            <strong class="info-tile-value">${esc(shownDate(d.last_entry_date)||'No Vouchers Entered')}</strong>
          </div>
        </div>
      </div>
      
      <div class="gateway-dashboard">
        <div class="kpi-grid">
          <div class="kpi-card kpi-sales" data-kpi="today_sales" data-action="kpiReport" data-args="today_sales">
            <div class="kpi-card-header">
              <span class="kpi-badge badge-sales">${SVG_GATEWAY.cart}</span>
              <span class="kpi-title">TODAY'S SALES</span>
            </div>
            <span class="kpi-value">${money(cents(todaySales.amount))}</span>
            <span class="kpi-sub">${todaySales.count} invoice(s)</span>
          </div>
          <div class="kpi-card kpi-collections" data-kpi="today_collections" data-action="kpiReport" data-args="today_collections">
            <div class="kpi-card-header">
              <span class="kpi-badge badge-collections">${SVG_GATEWAY.wallet}</span>
              <span class="kpi-title">TODAY'S COLLECTIONS</span>
            </div>
            <span class="kpi-value">${money(cents(m.today_collections || 0))}</span>
            <span class="kpi-sub">Cash & Bank</span>
          </div>
          <div class="kpi-card kpi-debtors" data-kpi="due_from_customers" data-action="kpiReport" data-args="due_from_customers">
            <div class="kpi-card-header">
              <span class="kpi-badge badge-debtors">${SVG_GATEWAY.users}</span>
              <span class="kpi-title">DUE FROM CUSTOMERS</span>
            </div>
            <span class="kpi-value">${money(cents(m.due_from_customers || 0))}</span>
            <span class="kpi-sub">Sundry Debtors</span>
          </div>
          <div class="kpi-card kpi-creditors" data-kpi="due_to_suppliers" data-action="kpiReport" data-args="due_to_suppliers">
            <div class="kpi-card-header">
              <span class="kpi-badge badge-creditors">${SVG_GATEWAY.truck}</span>
              <span class="kpi-title">DUE TO SUPPLIERS</span>
            </div>
            <span class="kpi-value">${money(cents(m.due_to_suppliers || 0))}</span>
            <span class="kpi-sub">Sundry Creditors</span>
          </div>
        </div>

        <div class="kpi-secondary-grid">
          <div class="kpi-card kpi-profit" data-kpi="month_profit" data-action="kpiReport" data-args="month_profit">
            <div class="kpi-card-header">
              <span class="kpi-badge badge-profit">${SVG_GATEWAY.trend}</span>
              <span class="kpi-title">THIS MONTH'S PROFIT</span>
            </div>
            <span class="kpi-value">${money(cents(m.month_profit || 0))}</span>
            <span class="kpi-sub">Net Margin</span>
          </div>

          <div class="trend-card">
            <div class="trend-header">
              <div class="trend-title-wrap">
                <span class="trend-icon">${SVG_GATEWAY.chart}</span>
                <span class="trend-title">Sales Performance Trend</span>
              </div>
              <div class="trend-toggles">
                <button type="button" data-trend="week" class="${activeSpan==='week'?'active':''}">Week</button>
                <button type="button" data-trend="month" class="${activeSpan==='month'?'active':''}">Month</button>
                <button type="button" data-trend="year" class="${activeSpan==='year'?'active':''}">Year</button>
              </div>
            </div>
            <div class="trend-chart">
              ${renderTrendSvg(trendData, activeSpan)}
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="gateway-menu-wrap">${menuHtml('Gateway of Books',gatewayItems())}</section>
  </div>`;
  loadGatewayDashboard();
}

function showSpecialThanksDialog() {
  const body = `
  <div class="special-thanks-modal">
    <div class="special-thanks-card">
      <div class="developer-badge">AUTHOR & LEAD DEVELOPER</div>
      <div class="developer-title">Made by : <strong>Sahil Mondal</strong></div>
      <div class="developer-sub">Independent Books • Financial & Inventory Accounting System</div>
      <div class="developer-contact-links" style="margin-top:12px; display:flex; flex-wrap:wrap; gap:10px;">
        <a href="mailto:mossoassistant@gmail.com" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; color:#a7f3d0; text-decoration:none; background:rgba(255,255,255,0.12); padding:5px 12px; border-radius:6px; border:1px solid rgba(167,243,208,0.25); font-size:12px; font-weight:600;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <span>mossoassistant@gmail.com</span>
        </a>
        <a href="https://www.instagram.com/wilde_sahil/" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; color:#fbcfe8; text-decoration:none; background:rgba(255,255,255,0.12); padding:5px 12px; border-radius:6px; border:1px solid rgba(251,207,232,0.25); font-size:12px; font-weight:600;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          <span>@wilde_sahil (Instagram)</span>
        </a>
      </div>
    </div>
    
    <div class="thanks-section">
      <div class="thanks-header-label">Special thanks to:</div>
      <div class="thanks-grid">
        <div class="thanks-item">
          <div class="thanks-item-bullet"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/></svg></div>
          <div class="thanks-item-info">
            <strong>Antigravity</strong>
            <small>Next-generation agentic AI pair programming system</small>
          </div>
        </div>
        <div class="thanks-item">
          <div class="thanks-item-bullet"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/></svg></div>
          <div class="thanks-item-info">
            <strong>Omnirush</strong>
            <small>For giving free AI models and high-performance inference</small>
          </div>
        </div>
      </div>
    </div>

    <div class="dialog-buttons" style="margin-top:16px;">
      <button data-action="close">OK</button>
    </div>
  </div>`;
  showDialog('Special Thanks & Credits', body, {className: 'thanks-dialog-container'});
}
function gatewayItems() {return [{heading:'MASTERS'},['Create','create'],['Alter','alter'],['Chart of Accounts','masters','ledger'],['Item Rates Manager','ratesManager'],{heading:'TRANSACTIONS'},['Vouchers','voucher',''],['Day Book','report','Day Book'],{heading:'UTILITIES'},['Banking','menu','Banking'],{heading:'REPORTS'},['Balance Sheet','report','Balance Sheet'],['Profit & Loss A/c','report','Profit & Loss A/c'],['Stock Summary','report','Stock Summary'],['Ratio Analysis','report','Ratio Analysis'],['Display More Reports','menu','Display More Reports'],['Dashboard','dashboard'],['Quit','quit','', 'separated']];}
const menus={
 'Display More Reports':[{heading:'ACCOUNTING'},['Trial Balance','report','Trial Balance'],['Day Book','report','Day Book'],['Account Books','menu','Account Books'],['Statements of Accounts','menu','Statements of Accounts'],{heading:'INVENTORY'},['Inventory Books','menu','Inventory Books'],['Statements of Inventory','menu','Statements of Inventory'],{heading:'STATUTORY'},['Statutory Reports','menu','Statutory Reports']],
 'Account Books':[['Cash/Bank Book(s)','report','Cash/Bank Book(s)'],['Ledger','chooseLedger'],['Group Summary','chooseGroup'],['Group Vouchers','chooseGroup'],['Sales Register','report','Sales Register'],['Purchase Register','report','Purchase Register'],['Journal Register','report','Journal Register'],['Debit Note Register','report','Debit Note Register'],['Credit Note Register','report','Credit Note Register']],
 'Statements of Accounts':[['Outstandings','menu','Outstandings'],['Statistics','report','Statistics']],
 'Outstandings':[['Receivables','report','Receivables'],['Payables','report','Payables'],['Ageing','report','Ageing'],['Ledger','chooseLedger']],
 'Inventory Books':[['Stock Summary','report','Stock Summary'],['Stock Item','chooseItem'],['Stock Group Summary','report','Stock Summary'],['Stock Transfers','report','Stock Transfers'],['Physical Stock Register','report','Physical Stock Register']],
 'Statements of Inventory':[['Stock Query','chooseItem'],['Sales Orders','report','Sales Orders'],['Purchase Orders','report','Purchase Orders']],
 'Banking':[['Bank Reconciliation','chooseBank'],['Cheque Register','report','Cheque Register']],
 'Statutory Reports':[['GST','menu','GST']],
 'GST':[['GST Ledger Summary','report','GST Ledger Summary']],
};
function menuHtml(title,items) {let index=0;return `<div class="menu-box"><div class="menu-title">${esc(title)}</div><div class="menu-body">${items.map(item=>item.heading?`<div class="menu-category">${esc(item.heading)}</div>`:rowButton(item[0],item[1],item[2],index++===frame().cursor,item[3]||'')).join('')}</div></div>`;}
function renderMenu(f) {$('#title').textContent=f.name;$('#screen').innerHTML=`<div class="gateway-menu-wrap" style="height:100%">${menuHtml(f.name,menus[f.name]||[])}</div>`;}
function namesFor(kind) {const records=state.data[fields[kind]]||[];return Array.isArray(records)?records.map(x=>typeof x==='string'?x:x.name||x.symbol):Object.keys(records);}
function recordFor(kind,name) {return clone((['ledger','stock_item'].includes(kind)?state.data[fields[kind]][name]:state.data.master_records[kind]?.[name])||{name,...(kind==='voucher_type'?{base_type:name}:{})});}
function renderMasters(f) {$('#title').textContent='Chart of Accounts';const kind=f.masterKind||'ledger';$('#screen').innerHTML=`<div class="report"><div class="report-caption"><strong>${esc(kinds[kind])}</strong><div class="report-meta">${esc(state.data.active_company)}<br><button data-action="selectKind">Change master</button> · <button data-action="master" data-args="${kind}">Create</button></div></div><div class="report-scroll"><table class="report-table"><thead><tr><th>Name</th><th>Under</th><th class="amount">Opening Balance</th></tr></thead><tbody>${namesFor(kind).map((name,i)=>{const r=recordFor(kind,name);return `<tr data-row data-action="master" data-args="${esc(kind+'|'+name)}"><td>${esc(name)}</td><td>${esc(r.parent||r.base_type||'')}</td><td class="amount">${kind==='ledger'?money(cents(r.signed_opening))+' '+(cents(r.signed_opening)>=0n?'Dr':'Cr'):''}</td></tr>`;}).join('')}</tbody></table>${!namesFor(kind).length?'<div class="empty">No masters created</div>':''}</div></div>`;setKeys([['F3','Company','company'],'gap',['C','Create','master',kind],['H','Change master','selectKind'],['F12','Setting','unifiedSettings']]);}
function field(name,label,value='',type='text',options=null) {const id='field-'+name;return `<div class="field"><label for="${id}">${esc(label)}</label>${options?`<select id="${id}" name="${esc(name)}"><option value=""></option>${options.map(option=>`<option ${String(value)===String(option)?'selected':''}>${esc(option)}</option>`).join('')}</select>`:`<input id="${id}" name="${esc(name)}" type="${type==='date'?'text':type}" class="${type==='date'?'tally-date':''}" inputmode="${type==='date'?'numeric':''}" value="${esc(type==='date'?inputDate(value):value)}" autocomplete="off">`}</div>`;}
function ledgerField(name,label,value='',options=[]) {return field(name,label,value,'text',options);}
function ledgerSelect(name,label,value='',options=[]) {return '<select name="'+esc(name)+'" aria-label="'+esc(label)+'"><option value=""></option>'+options.map(option=>'<option '+(String(value)===String(option)?'selected':'')+'>'+esc(option)+'</option>').join('')+'</select>';}
function cashBankNames() {return Object.keys(state.data.ledgers).filter(name=>['Bank Accounts','Bank OCC A/c','Bank OD A/c','Cash-in-hand'].includes(state.data.ledgers[name].group_type||state.data.ledgers[name].parent));}
function paymentPartyNames() {const banks=new Set(cashBankNames());return Object.keys(state.data.ledgers).filter(name=>!banks.has(name));}
function paymentBalanceText(name) {if(!name)return 'Outstanding balance: —';const balance=voucherRules.balanceFromLedger(state.data.ledgers[name]);return 'Outstanding balance: '+money(cents(balance.amount))+' '+balance.drcr;}
function updatePaymentBalance() {const select=$('#edit-form [name=party]'),target=$('#payment-balance');if(select&&target)target.textContent=paymentBalanceText(select.value);}
 function paymentEditor(v,base='Payment') {const rows=listOf(v),banks=cashBankNames(),parties=paymentPartyNames(),bankEntry=rows.find(e=>banks.includes(e.LEDGERNAME))||{},partyEntry=rows.find(e=>e.LEDGERNAME===v.PARTYLEDGERNAME)||rows.find(e=>parties.includes(e.LEDGERNAME))||{},amount=partyEntry.AMOUNT?decimalMoney(abs(signedEntry(partyEntry))):'',direction=base==='Receipt'?'Debit bank / cash and credit the party':'Debit the party and credit bank / cash';return `<table id="payment-table" class="payment-table"><tbody><tr><td class="payment-label">Party / Ledger</td><td>${ledgerSelect('party','Party / Ledger',v.PARTYLEDGERNAME,parties)}</td><td><span id="payment-balance">${paymentBalanceText(v.PARTYLEDGERNAME)}</span></td></tr><tr><td class="payment-label">Bank / Cash</td><td>${ledgerSelect('payment_bank','Bank / Cash',bankEntry.LEDGERNAME,banks)}</td><td class="payment-help">Select the account affected by the ${base.toLowerCase()}</td></tr><tr><td class="payment-label">Amount</td><td><input name="payment_amount" class="amount" inputmode="decimal" value="${esc(amount)}"></td><td>${direction}</td></tr></tbody></table>`;}
 function defaultBillingProfile() {return {fields:[{key:'item',label:'Item',kind:'item',required:true},{key:'qty',label:'Quantity',kind:'number',required:true},{key:'alt_qty',label:'Alt Quantity',kind:'number',required:false},{key:'rate',label:'Rate',kind:'number',required:true},{key:'amount',label:'Amount',kind:'calculated',required:true}],formula:'qty * rate',quantity_basis:'qty'};}
 function billingProfileFor(base) {return clone(state.data.company_meta?.billing_profiles?.[base]||defaultBillingProfile());}
 function billingFieldValue(row,field) {if(field.key==='item')return row.querySelector('[name=item]')?.value||'';if(field.key==='amount')return row.querySelector('[name=itemamount]')?.value||'';return row.querySelector('[name="'+field.key+'"]')?.value||'';}
 function updateBillingRow(row) {const profile=state.draft?.billingProfile||billingProfileFor(state.draft?.base);if(!profile||!row)return;const values={};for(const field of profile.fields)if(field.kind!=='item'&&field.kind!=='calculated')values[field.key]=billingFieldValue(row,field)||'0';try{const amount=voucherRules.evaluateBillingFormula(profile.formula,values);const target=row.querySelector('[name=itemamount]');if(target)target.value=amount;}catch(error){const target=row.querySelector('[name=itemamount]');if(target)target.value='';}}
function itemTaxRate(form,row) {const name=row?.querySelector('[name=item]')?.value||'',item=state.data.stock_items[name]||{},account=state.data.ledgers[form.querySelector('[name=account]')?.value||'']||{};if(name&&Object.prototype.hasOwnProperty.call(item,'gst_rate')&&String(item.gst_rate).trim()!=='')return Number(item.gst_rate)||0;if(account.tax_rate!==undefined&&String(account.tax_rate).trim()!=='')return Number(account.tax_rate)||0;return state.data.company_meta?.gstin?18:0;}
function invoiceTaxRate(form) {const rows=Array.from(form.querySelectorAll('.inventory-entry')).filter(row=>row.querySelector('[name=item]')?.value);return rows.length?Math.max(...rows.map(row=>itemTaxRate(form,row))):Number(state.data.ledgers[form.querySelector('[name=account]')?.value||'']?.tax_rate||0)|| (state.data.company_meta?.gstin?18:0);}
function invoiceTaxComponents(form,taxableAmount) {if(!state.data.company_meta?.gstin)return [];const party=state.data.ledgers[form.querySelector('[name=party]')?.value||'']||{},same=!party.state||!state.data.company_meta.state||String(party.state).trim().toLowerCase()===String(state.data.company_meta.state).trim().toLowerCase(),totals={};for(const row of form.querySelectorAll('.inventory-entry')){const item=state.data.stock_items[row.querySelector('[name=item]')?.value||'']||{},amount=Number(cents(row.querySelector('[name=itemamount]')?.value||0))/100,rate=Number(item.gst_rate||0)||Number(state.data.ledgers[form.querySelector('[name=account]')?.value||'']?.tax_rate||0)||18;if(amount<=0)continue;for(const component of voucherRules.gstComponents(amount,rate,same)){const current=totals[component.ledger]||{amount:0,rates:new Set()};current.amount+=Number(component.amount);current.rates.add(component.rate);totals[component.ledger]=current;}}const itemCents=Array.from(form.querySelectorAll('.inventory-entry')).reduce((sum,row)=>sum+cents(row.querySelector('[name=itemamount]')?.value||0),0n),extraCents=BigInt(taxableAmount||0)-itemCents;if(extraCents){const rate=invoiceTaxRate(form);for(const component of voucherRules.gstComponents(Number(extraCents)/100,rate,same)){const current=totals[component.ledger]||{amount:0,rates:new Set()};current.amount+=Number(component.amount);current.rates.add(component.rate);totals[component.ledger]=current;}}return Object.entries(totals).map(([ledger,value])=>({ledger,amount:value.amount.toFixed(2),rate:value.rates.size===1?[...value.rates][0]:'mixed'}));}
function renderInvoiceTaxPreview(taxableAmount) {const target=$('#tax-preview'),form=$('#edit-form');if(!target||!form)return;const components=invoiceTaxComponents(form,taxableAmount);target.innerHTML=components.length?'<div class="auto-tax-title">Automatic GST</div>'+components.map(c=>`<div class="auto-tax-row"><span>${esc(c.ledger)} @ ${esc(c.rate)}%</span><strong>${money(cents(c.amount))}</strong></div>`).join(''):'';}
function ensureInvoiceRow(section) {const rows=Array.from(section.querySelectorAll('.inventory-entry'));const last=rows.at(-1);if(!last)return false;const complete=voucherRules.shouldAppendInvoiceRow({item:last.querySelector('[name=item]')?.value,qty:last.querySelector('[name=qty]')?.value,rate:last.querySelector('[name=rate]')?.value,amount:last.querySelector('[name=itemamount]')?.value});if(!complete)return false;last.insertAdjacentHTML('afterend',inventoryLine());state.draft.dirty=true;state.draft.accountingDirty=true;last.nextElementSibling.querySelector('[name=item]')?.focus();return true;}
function ensureExtraLedgerRow() {const body=$('#extra-table tbody');if(!body)return false;const rows=Array.from(body.querySelectorAll('.entry')),last=rows.at(-1);if(!last)return false;const complete=Boolean(last.querySelector('[name=ledger]')?.value&&last.querySelector('[name=amount]')?.value);if(!complete)return false;last.insertAdjacentHTML('afterend',ledgerLine());state.draft.dirty=true;state.draft.accountingDirty=true;last.nextElementSibling.querySelector('[name=ledger]')?.focus();return true;}
function focusNextControl(control) {const controls=Array.from($('#edit-form').querySelectorAll('input,select,textarea')).filter(x=>x.offsetParent!==null),index=controls.indexOf(control);if(index===controls.length-1)return accept();controls[index+1]?.focus();}
function focusPreviousControl(control) {const controls=Array.from($('#edit-form').querySelectorAll('input,select,textarea')).filter(x=>x.offsetParent!==null),index=controls.indexOf(control);controls[Math.max(0,index-1)]?.focus();}
function modeLabel(mode) {return ({invoice:'Item Invoice',accounting_invoice:'Accounting Invoice',voucher:'As Voucher'})[mode]||mode;}
function captureModeSnapshot() {
 let rawInventory={};
 for(const section of document.querySelectorAll('.inventory-section')){
  const key=section.dataset.key;rawInventory[key]=Array.from(section.querySelectorAll('.inventory-entry')).map(row=>({
   STOCKITEMNAME:row.querySelector('[name=item]')?.value||'',ACTUALQTY:row.querySelector('[name=qty]')?.value||'',BILLEDQTY:row.querySelector('[name=qty]')?.value||'',RATE:row.querySelector('[name=rate]')?.value||'',AMOUNT:row.querySelector('[name=itemamount]')?.value||''
  })).filter(row=>Object.values(row).some(Boolean));
 }
 let snapshot;
 try{snapshot=collectVoucher();}catch(error){snapshot=clone(state.draft.original||{});}
 for(const [key,rows] of Object.entries(rawInventory))if(rows.length)snapshot[key]=rows;else if(state.draft.original?.[key])snapshot[key]=clone(state.draft.original[key]);
 snapshot.NARRATION=$('#edit-form [name=narration]')?.value||snapshot.NARRATION||'';
 return snapshot;
}
function showVoucherModeDialog() {const choices=voucherRules.modeChoices(state.draft.base);showDialog('Change Voucher Mode',`<div class="list">${choices.map(mode=>`<button class="list-row" data-choice="${mode}">${modeLabel(mode)}</button>`).join('')}</div><div class="inline-hint">Entered headers, rows, allocations and narration are preserved.</div>`,{className:'lookup-dialog'});state.dialog.choose=mode=>{const snapshot=captureModeSnapshot(),f=frame();state.draft=voucherRules.preserveVoucherDraft({...state.draft,...snapshot},mode);f.mode=mode;f.existing=snapshot;f.draftOnly=!snapshot.MASTERID;state.draft=null;render();note('Mode changed; draft preserved');};}
function openCalculator() {
 if(!state.calculator)state.calculator={origin:document.activeElement};
 state.calculatorHistory=state.calculatorHistory||[];
 let pane=$('#calculator-pane');
 if(!pane){
  pane=document.createElement('div');pane.id='calculator-pane';
  pane.innerHTML='<div class="calculator-title">Calculator <span>Ctrl+M / Esc to return</span></div><input id="calculator-input" aria-label="Calculator expression" autocomplete="off"><div id="calculator-result"></div><ol id="calculator-history"></ol>';
  document.body.appendChild(pane);
  pane.addEventListener('keydown',event=>{
   event.stopPropagation();
   if(event.key==='Escape'||(event.ctrlKey&&event.key.toLowerCase()==='m')){event.preventDefault();closeCalculator();}
   else if(event.key==='Enter'){
    event.preventDefault();
    try{
     const result=voucherRules.safeCalculate($('#calculator-input').value);
     $('#calculator-result').textContent=result.display;
     state.calculatorHistory.unshift({expression:$('#calculator-input').value,result:result.display});
     state.calculatorHistory=state.calculatorHistory.slice(0,10);
     $('#calculator-history').innerHTML=state.calculatorHistory.map(row=>`<li>${esc(row.expression)} = ${esc(row.result)}</li>`).join('');
    }catch(error){$('#calculator-result').textContent=error.message;}
   }
  });
 }
 pane.hidden=false;$('#calculator-input').focus();
}
function closeCalculator() {const origin=state.calculator?.origin;const pane=$('#calculator-pane');if(pane)pane.hidden=true;if(origin?.isConnected)origin.focus();state.calculator=null;}
function renderCompanyForm(f) {const r=f.edit?state.data.company_meta:{};state.draft={kind:'company',original:clone(r),dirty:false};$('#title').textContent='Company '+(f.edit?'Alteration':'Creation');const deleteBtn=f.edit?'<button type="button" class="btn-danger" data-action="deleteCompany">Delete Company</button>':'';$('#screen').innerHTML=`<div class="form-screen"><form class="master-form" id="edit-form"><div class="form-grid"><section class="form-column">${field('name','Name',r.name)}${field('mailing_name','Mailing name',r.mailing_name)}${field('address','Address',r.address)}${field('state','State',r.state)}${field('country','Country',r.country)}${field('pincode','Pincode',r.pincode)}<div class="form-heading">Contact Details</div>${field('phone','Telephone',r.phone)}${field('email','E-mail',r.email,'email')}</section><section class="form-column">${field('starting_from','Financial year beginning from',r.starting_from,'date')}${field('ending_at','Financial year ending at',r.ending_at,'date')}${field('books_from','Books beginning from',r.books_from||r.starting_from,'date')}<div class="form-heading">Base Currency Information</div>${field('currency','Base currency symbol',r.currency)}${field('currency_name','Formal name',r.currency_name)}<div class="form-heading">Tax Registration</div>${field('gstin','GSTIN / UIN',r.gstin)}</section></div><div class="form-actions"><button type="button" data-action="accept">Accept</button>${deleteBtn}<button type="button" data-action="back">Quit</button></div></form></div>`;$('#field-name').focus();const keys=[['F3','Company','company'],['A','Accept','accept']];if(f.edit)keys.push(['D','Delete','deleteCompany']);setKeys(keys);}
 function renderMaster(f) {const kind=f.masterKind,r=f.name?recordFor(kind,f.name):{parent:f.defaultParent||''};state.draft={kind,original:clone(r),dirty:false};$('#title').textContent=kinds[kind].replace(/s$/,'')+' '+(f.name?'Alteration':'Creation');let body=field('name',kind==='unit'?'Symbol':'Name',r.name||r.symbol)+field('alias','(alias)',r.alias);if(kind==='ledger')body+=field('parent','Under',r.parent,'text',state.data.groups)+field('is_billwise','Maintain balances bill-by-bill',r.is_billwise,'text',['Yes','No'])+'<div class="form-heading">Mailing Details</div>'+field('mailing_name','Name',r.mailing_name)+field('address','Address',r.address)+field('state','State',r.state)+field('pincode','Pincode',r.pincode)+'<div class="form-heading">Tax Registration Details</div>'+field('gstin','GSTIN / UIN',r.gstin)+field('tax_rate','Tax rate (%)',r.tax_rate,'number')+'<div class="opening">'+field('opening_balance','Opening Balance',r.opening_balance)+field('drcr','Dr / Cr',r.drcr||'Dr','text',['Dr','Cr'])+'</div>';
else if(kind==='stock_item')body+=field('parent','Under',r.parent,'text',state.data.stock_groups)+field('category','Category',r.category,'text',state.data.stock_categories)+field('base_units','Units',r.base_units,'text',state.data.units)+field('hsn','HSN / SAC',r.hsn)+field('gst_rate','GST rate (%)',r.gst_rate,'number')+'<div class="opening">'+field('opening_qty','Opening Quantity',r.opening_qty)+field('opening_balance','Opening Value',r.opening_balance)+field('opening_rate','Opening Rate',r.opening_rate)+'</div>';
else if(kind==='group')body+=field('parent','Under',r.parent,'text',['Primary',...state.data.groups.filter(x=>x!==f.name)])+field('is_revenue','Group behaves like a sub-ledger',r.is_revenue,'text',['Yes','No']);
else if(kind==='voucher_type')body+=field('base_type','Type of voucher',r.base_type,'text',Array.from(new Set(['Contra','Payment','Receipt','Journal','Sales','Purchase','Credit Note','Debit Note',...nonAccounting])))+field('numbering','Method of voucher numbering',r.numbering,'text',['Automatic','Manual']);
else if(kind==='unit')body+=field('formal_name','Formal name',r.formal_name)+field('decimal_places','Number of decimal places',r.decimal_places,'number');
else if(kind==='currency')body+=field('formal_name','Formal name',r.formal_name)+field('decimal_places','Number of decimal places',r.decimal_places,'number');
else body+=field('parent','Under',r.parent,'text',kind==='godown'?['Primary',...state.data.godowns]:kind==='stock_group'?state.data.stock_groups:kind==='cost_centre'?['Primary',...state.data.cost_centres]:['Primary']);
$('#screen').innerHTML=`<div class="form-screen"><form class="master-form narrow" id="edit-form">${body}<div class="form-actions"><button type="button" data-action="accept">Accept</button><button type="button" data-action="back">Quit</button></div></form></div>`;$('#field-name').focus();setKeys([['A','Accept','accept'],['F12','Setting','unifiedSettings']]);}
function tableReport(title,headers,rows,total='',period=state.data) {const cols='<colgroup>'+headers.map(h=>'<col '+(/Debit|Credit|Amount|Balance|Value/.test(h)?'style="width:160px"':h==='Date'?'style="width:100px"':/Vch/.test(h)?'style="width:130px"':'')+'>').join('')+'</colgroup>';$('#title').textContent=title;$('#screen').innerHTML=`<div class="report"><div class="report-caption"><strong>${esc(headers[0]||'Particulars')}</strong><div class="report-meta"><b>${esc(state.data.active_company)}</b><br>${esc(shownDate(period.from_date))} to ${esc(shownDate(period.to_date))}</div></div><table class="report-table">${cols}<thead><tr>${headers.map((h,i)=>`<th class="${i&&/Amount|Balance|Debit|Credit|Value/.test(h)?'amount':''}">${esc(h)}</th>`).join('')}</tr></thead></table><div class="report-scroll"><table class="report-table">${cols}<tbody>${rows.map((r,i)=>`<tr data-row ${r.action?`data-action="${r.action}" data-args="${esc(r.args)}"`:''}>${r.cells.map((cell,j)=>`<td class="${j&&/Amount|Balance|Debit|Credit|Value/.test(headers[j])?'amount':''}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${!rows.length?'<div class="empty">No entries in this period</div>':''}</div><div class="report-total"><span>Grand Total</span><span>${esc(total)}</span></div></div>`;}
function voucherRows(vs) {return vs.map(v=>({action:'editVoucher',args:v.MASTERID,cells:[shownDate(v.DATE),v.PARTYLEDGERNAME||listOf(v).find(e=>signedEntry(e)<0n)?.LEDGERNAME||'',v.VOUCHERTYPENAME,v.VOUCHERNUMBER,active(v)?money(amountOf(v)):(v.ISOPTIONAL==='Yes'?'Optional':'Cancelled')]}));}
async function renderAgeing(f) {
 $('#title').textContent='Outstanding Bills — Ageing';
 $('#screen').innerHTML='<div class="report"><div class="report-caption"><strong>OUTSTANDING BILLS</strong><div class="report-meta"><b>'+esc(state.data.active_company)+'</b></div></div><div class="ageing-controls"><label>As of <input id="ageing-as-of" class="tally-date" value="'+esc(inputDate(state.data.to_date))+'"></label><label>Basis <select id="ageing-basis"><option value="due_date">Due date</option><option value="invoice_date">Invoice date</option></select></label><button data-action="refreshAgeing">Refresh</button></div><div id="ageing-body" class="report-scroll"><div class="empty">Loading ageing...</div></div></div>';
 setKeys([['F2','Period','period'],['F3','Company','company'],['F5','Refresh','refreshAgeing'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);
 const load=async()=>{const asOf=voucherRules.parseTallyDate($('#ageing-as-of').value||state.data.to_date);const query=new URLSearchParams({company:state.data.active_company,as_of:asOf,basis:$('#ageing-basis').value});const result=await api('/api/ageing?'+query);const report=result.report;const sections=Object.entries(report.buckets).map(([bucket,rows])=>[bucket,rows]).concat([['Not yet due',report.not_yet_due],['Undated',report.undated]]);$('#ageing-body').innerHTML=sections.map(([bucket,rows])=>`<section class="ageing-section"><h3>${esc(bucket)}</h3><table class="report-table"><thead><tr><th>Bill</th><th>Party</th><th>Date</th><th>Due date</th><th class="amount">Pending</th></tr></thead><tbody>${rows.map(row=>`<tr data-row data-action="ledgerReport" data-args="${esc(row.ledger)}"><td>${esc(row.name)}</td><td>${esc(row.ledger)}</td><td>${esc(shownDate(row.date)||'Undated')}</td><td>${esc(shownDate(row.due_date)||'Undated')}</td><td class="amount">${money(cents(row.pending))} ${esc(row.drcr||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">None</td></tr>'}</tbody></table></section>`).join('');};f.loadAgeing=load;await load();
}
const ledgerRow=(name,l)=>({action:'ledgerReport',args:name,cells:[name,cents(l.signed_closing)>0n?money(cents(l.signed_closing)):'',cents(l.signed_closing)<0n?money(cents(l.signed_closing)):'' ]});
 function renderReport(f) {const d=state.data,t=f.name;const period=reportPeriod(f,d),live=d.vouchers.filter(v=>active(v)&&v.DATE>=period.from_date&&v.DATE<=period.to_date);let rows=[],headers=['Particulars','Debit','Credit'],total='';
 if(t==='Day Book'||t==='Voucher Register'||t==='Stock Transfers'||t==='Physical Stock Register'||t==='Sales Orders'||t==='Purchase Orders') {let vs=d.vouchers;if(f.period||f.month)vs=vs.filter(v=>v.DATE>=period.from_date&&v.DATE<=period.to_date);if(f.vtype)vs=vs.filter(v=>v.VOUCHERTYPENAME===f.vtype);if(f.month)vs=vs.filter(v=>v.DATE.startsWith(f.month));const type={'Stock Transfers':'Stock Journal','Physical Stock Register':'Physical Stock','Sales Orders':'Sales Order','Purchase Orders':'Purchase Order'}[t];if(type)vs=vs.filter(v=>v.VOUCHERTYPENAME===type);rows=voucherRows(vs);headers=['Date','Particulars','Vch Type','Vch No.','Amount'];total=money(vs.filter(active).reduce((s,v)=>s+amountOf(v),0n));}
  else if(t==='Trial Balance') {const openingStock=Object.values(d.stock_items||{}).reduce((s,x)=>s+cents(x.opening_balance),0n);rows=Object.entries(d.ledgers).map(([n,l])=>ledgerRow(n,l));if(openingStock>0n)rows.push({action:'report',args:'Stock Summary',cells:['Opening Stock',money(openingStock),'']});if(!f.ledgerWise){const totals={};for(const l of Object.values(d.ledgers)){const name=l.root_group_name||l.root_group;totals[name]=(totals[name]||0n)+cents(l.signed_closing);}if(openingStock>0n)totals['Current Assets']=(totals['Current Assets']||0n)+openingStock;rows=Object.entries(totals).map(([name,amount])=>({action:'groupReport',args:name,cells:[name,amount>0n?money(amount):'',amount<0n?money(amount):'']}));}const debit=Object.values(d.ledgers).reduce((s,l)=>s+(cents(l.signed_closing)>0n?cents(l.signed_closing):0n),0n)+openingStock;const credit=Object.values(d.ledgers).reduce((s,l)=>s+(cents(l.signed_closing)<0n?-cents(l.signed_closing):0n),0n);const diff=debit-credit;if(diff!==0n){rows.push({action:'',args:'',cells:['Diff. in Opening Balances',diff<0n?money(-diff):'',diff>0n?money(diff):'']});}const finalDebit=debit>credit?debit:credit;const finalCredit=debit>credit?debit:credit;total=`${money(finalDebit)}     ${money(finalCredit)}`;}
 else if(t==='Group Summary'||t==='Cash/Bank Book(s)'||t==='GST Ledger Summary') {const group=f.group;function under(g){const seen=new Set();while(g&&!seen.has(g)){if(g===group)return true;seen.add(g);g=d.group_records[g]?.parent;}return false;}rows=Object.entries(d.ledgers).filter(([n,l])=>group?under(l.parent):t==='GST Ledger Summary'?(l.group_type||l.parent)==='Duties & Taxes':['Cash-in-hand','Bank Accounts','Bank OCC A/c','Bank OD A/c'].includes(l.group_type||l.parent)).map(([n,l])=>ledgerRow(n,l));}
 else if(t==='Ledger Monthly Summary'){const name=f.ledger;headers=['Particulars','Debit','Credit'];const months={};for(const v of live.filter(v=>!nonAccounting.has(baseType(v.VOUCHERTYPENAME))))for(const e of listOf(v))if(e.LEDGERNAME===name){const month=v.DATE.slice(0,6),a=signedEntry(e);months[month]||={dr:0n,cr:0n};if(a>0n)months[month].dr+=a;else months[month].cr-=a;}rows=Object.keys(months).sort().map(m=>({action:'ledgerMonth',args:name+'|'+m,cells:[new Date(Number(m.slice(0,4)),Number(m.slice(4))-1).toLocaleDateString('en',{month:'long',year:'numeric'}),money(months[m].dr),money(months[m].cr)]}));}
 else if(t==='Ledger Vouchers'||t==='Bank Reconciliation') {const name=f.ledger,summary=ledgerWindow(d,name,period);headers=['Date','Particulars','Vch Type','Vch No.','Debit','Credit'];if(t==='Bank Reconciliation')headers.push('Bank date');let debit=0n,credit=0n;rows=summary.vouchers.map(v=>{const amount=listOf(v).filter(e=>e.LEDGERNAME===name).reduce((s,e)=>s+signedEntry(e),0n);if(amount>0n)debit+=amount;else credit-=amount;const row={action:'editVoucher',args:v.MASTERID,cells:[shownDate(v.DATE),listOf(v).filter(e=>e.LEDGERNAME!==name).map(e=>e.LEDGERNAME).join(', '),v.VOUCHERTYPENAME,v.VOUCHERNUMBER,amount>0n?money(amount):'',amount<0n?money(amount):'']};if(t==='Bank Reconciliation')row.cells.push(shownDate(v.BANKDATE||''));return row;});total=`Opening: ${money(summary.opening)} ${summary.opening>=0n?'Dr':'Cr'}    Closing: ${money(summary.closing)} ${summary.closing>=0n?'Dr':'Cr'}`;}
 else if(t.endsWith(' Register')) {const type=t.replace(' Register','');headers=['Particulars','No. of Vouchers','Amount'];const monthly={};live.filter(v=>v.VOUCHERTYPENAME===type).forEach(v=>{const m=v.DATE.slice(0,6);monthly[m]||={count:0,sum:0n};monthly[m].count++;monthly[m].sum+=amountOf(v);});rows=Object.keys(monthly).sort().map(m=>({action:'month',args:type+'|'+m,cells:[new Date(Number(m.slice(0,4)),Number(m.slice(4))-1).toLocaleDateString('en',{month:'long',year:'numeric'}),monthly[m].count,money(monthly[m].sum)]}));total=money(Object.values(monthly).reduce((s,m)=>s+m.sum,0n));}
 else if(t==='Stock Summary') {headers=['Particulars','Quantity','Rate','Value'];rows=Object.entries(d.stock_items).map(([n,item])=>({action:'itemReport',args:n,cells:[n,item.closing_qty+' '+(item.base_units||''),Number(item.closing_rate||0).toFixed(2),money(cents(item.closing_balance))]}));total=money(Object.values(d.stock_items).reduce((s,x)=>s+cents(x.closing_balance),0n));}
 else if(t==='Stock Item Vouchers') {headers=['Date','Particulars','Vch Type','Quantity','Amount'];rows=[];for(const v of live)for(const key of ['ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST','CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST','PHYSICALSTOCKENTRIES.LIST'])for(const e of listOf(v,key))if(e.STOCKITEMNAME===f.item)rows.push({action:'editVoucher',args:v.MASTERID,cells:[shownDate(v.DATE),v.PARTYLEDGERNAME||'',v.VOUCHERTYPENAME,e.ACTUALQTY||e.BILLEDQTY||'',money(cents(e.AMOUNT))]});}
 else if(t==='Receivables'||t==='Payables') {const isRec=t==='Receivables';headers=['Reference','Party','Balance'];const list=d[isRec?'bills_receivable':'bills_payable']||[];rows=list.map(b=>{const c=cents(b.closing_balance);const disp=money(c)+(isRec?(c<0n?' Cr':c>0n?' Dr':''):(c<0n?' Dr':c>0n?' Cr':''));return {action:'ledgerReport',args:b.ledger,cells:[b.name,b.ledger,disp]};});const totalCents=list.reduce((s,b)=>s+cents(b.closing_balance),0n);total=money(totalCents)+(isRec?(totalCents<0n?' Cr':totalCents>0n?' Dr':''):(totalCents<0n?' Dr':totalCents>0n?' Cr':''));}
 else if(t==='Statistics') {headers=['Type of Voucher / Master','Count'];rows=[...d.voucher_types.map(type=>({action:'register',args:type,cells:[type,d.vouchers.filter(v=>v.VOUCHERTYPENAME===type).length]})),...Object.keys(kinds).map(k=>({action:'masters',args:k,cells:[kinds[k],namesFor(k).length]}))];}
 else if(t==='Balance Sheet'||t==='Profit & Loss A/c')return renderFinancialTree(f);
 else if(t==='Ratio Analysis') {headers=['Particulars','Value'];const sales=Object.values(d.ledgers).filter(l=>l.root_group==='Sales Accounts').reduce((s,l)=>s-cents(l.period_movement),0n);const debt=Object.values(d.ledgers).filter(l=>l.parent==='Sundry Debtors').reduce((s,l)=>s+cents(l.signed_closing),0n);rows=[{cells:['Sales',money(sales)]},{cells:['Receivables',money(debt)]},{cells:['Receivables / Sales',sales?`${Number(debt*10000n/sales)/100}%`:'Not applicable']}];}
 else if(t==='Cheque Register') {headers=['Date','Particulars','Cheque No.','Amount'];rows=live.filter(v=>v.CHEQUENUMBER).map(v=>({action:'editVoucher',args:v.MASTERID,cells:[shownDate(v.DATE),v.PARTYLEDGERNAME||'',v.CHEQUENUMBER,money(amountOf(v))]}));}
  tableReport(f.ledger||f.item?`${t} - ${f.ledger||f.item}`:t,headers,rows,total,period);const common=[['F2','Period','period'],['F3','Company','company'],'gap'];if(t==='Trial Balance')setKeys([...common,['F5',f.ledgerWise?'Group-wise':'Ledger-wise','toggleLedgerWise'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);else if(['Ledger Vouchers','Ledger Monthly Summary','Bank Reconciliation'].includes(t))setKeys([...common,['F4','Ledger','chooseLedger'],['F5',t==='Ledger Monthly Summary'?'Vouchers':'Monthly','ledgerSummary'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);else if(t==='Group Summary')setKeys([...common,['F4','Group','chooseGroup'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);else if(['Stock Summary','Stock Item Vouchers'].includes(t))setKeys([...common,['F4','Stock Item','chooseItem'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);else setKeys([...common,['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);}
 async function renderFinancialTree(f) {
  const d=state.data, period=reportPeriod(f,d), detailed=Boolean(f.detailed);
  $('#title').textContent=f.name;$('#screen').innerHTML='<div class="report"><div class="report-caption"><strong>'+esc(f.name)+'</strong><div class="report-meta"><b>'+esc(d.active_company)+'</b><br>'+esc(shownDate(period.from_date))+' to '+esc(shownDate(period.to_date))+'</div></div><div class="report-toolbar"><button data-action="toggleFinancialDetail">'+(detailed?'Condensed':'Detailed')+'</button><button data-action="comparison" data-args="'+esc(f.name)+'">Comparison</button></div><div id="financial-tree-body" class="report-scroll"><div class="empty">Loading report...</div></div></div>';
  setKeys([['F2','Period','period'],['F3','Company','company'],['F5',detailed?'Condensed':'Detailed','toggleFinancialDetail'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);
  const query=new URLSearchParams({company:d.active_company,report:f.name,period_id:f.period?.id||`${period.from_date}-${period.to_date}`,from:period.from_date,to:period.to_date,detailed:detailed?'1':'0'});
  const result=await api('/api/financial_tree?'+query),snapshot=result.snapshot;
  const displayAmount = node => {
    const c = cents(node.amount);
    if (node.isNegative || ((node.name === 'Closing Stock' || node.name === 'Opening Stock') && c < 0n)) {
      return '(-) ' + money(abs(c));
    }
    return money(abs(c));
  };
  const rowHtml=node=>`<tr data-row data-report-node="${esc(node.name)}" data-action="reportDrill" data-args="${esc(JSON.stringify(node))}"><td style="padding-left:${8+(node.parent_id?18:0)}px">${esc(node.name)}</td><td class="amount">${displayAmount(node)}</td></tr>${(node.children||[]).map(rowHtml).join('')}`;
  let leftRoots = [], rightRoots = [];
  if (f.name === 'Balance Sheet') {
    const stock = Object.values(d.stock_items || {}).reduce((s, x) => s + cents(x.closing_balance), 0n);
    const openingStock = Object.values(d.stock_items || {}).reduce((s, x) => s + cents(x.opening_balance), 0n);
    const stockDelta = stock - openingStock;
    for (const node of snapshot.roots) {
      const nameLower = node.name.toLowerCase();
      let isLiab;
      if (nameLower.includes('profit & loss')) {
        if (stockDelta !== 0n) {
          const adj = cents(node.amount) - stockDelta;
          node.amount = (Number(adj) / 100).toFixed(2);
        }
        // In Tally Prime: Net Profit (credit, <= 0 amount) goes to Liabilities (left).
        // Net Loss (debit, > 0 amount) goes to Assets (right).
        isLiab = cents(node.amount) <= 0n;
      } else if (nameLower.includes('asset') || nameLower.includes('investment') || nameLower.includes('stock')) {
        isLiab = false;
      } else if (nameLower.includes('liabilit') || nameLower.includes('capital') || nameLower.includes('reserve') || nameLower.includes('equity')) {
        isLiab = true;
      } else {
        isLiab = cents(node.amount) < 0n;
      }
      if (isLiab) leftRoots.push(node);
      else rightRoots.push(node);
    }
  } else if (f.name === 'Profit & Loss A/c') {
    const stock = Object.values(d.stock_items || {}).reduce((s, x) => s + cents(x.closing_balance), 0n);
    const openingStock = Object.values(d.stock_items || {}).reduce((s, x) => s + cents(x.period_opening_value || x.opening_balance), 0n);
    const stockDelta = stock - openingStock;
    if (openingStock !== 0n) {
      leftRoots.push({
        name: 'Opening Stock',
        amount: (Number(openingStock) / 100).toFixed(2),
        children: [],
        node_type: 'calculated',
        isNegative: openingStock < 0n
      });
    }
    if (stock !== 0n) {
      rightRoots.push({
        name: 'Closing Stock',
        amount: (Number(stock) / 100).toFixed(2),
        children: [],
        node_type: 'calculated',
        isNegative: stock < 0n
      });
    }
    const expKeywords = ['expense', 'purchase', 'cost', 'opening stock', 'trading'];
    for (const node of snapshot.roots) {
      const isExp = expKeywords.some(k => node.name.toLowerCase().includes(k)) || (cents(node.amount) > 0n);
      if (isExp) leftRoots.push(node);
      else rightRoots.push(node);
    }
    const nominalProfit = cents(snapshot.totals?.profit || 0);
    const netProfitCents = nominalProfit + stockDelta;
    if (netProfitCents > 0n) {
      // Net Profit: In Tally Prime, Nett Profit is placed on Expenses (Left) side to balance with Income
      leftRoots.push({
        name: 'Nett Profit',
        amount: (Number(netProfitCents) / 100).toFixed(2),
        children: [],
        node_type: 'calculated',
        period: snapshot.period,
        company: snapshot.company
      });
    } else if (netProfitCents < 0n) {
      // Net Loss: In Tally Prime, Nett Loss is placed on Income (Right) side to balance with Expenses
      rightRoots.push({
        name: 'Nett Loss',
        amount: (Number(-netProfitCents) / 100).toFixed(2),
        children: [],
        node_type: 'calculated',
        period: snapshot.period,
        company: snapshot.company
      });
    }
  } else {
    leftRoots = snapshot.roots;
  }

  if (f.name === 'Balance Sheet' || f.name === 'Profit & Loss A/c') {
    const leftTitle = f.name === 'Balance Sheet' ? 'Liabilities' : 'Expenses';
    const rightTitle = f.name === 'Balance Sheet' ? 'Assets' : 'Income';
    let leftTotal = 0n, rightTotal = 0n;
    if (f.name === 'Profit & Loss A/c') {
      leftTotal = leftRoots.reduce((s, node) => s + cents(node.amount), 0n);
      rightTotal = rightRoots.reduce((s, node) => {
        if (node.name === 'Closing Stock' || node.name === 'Nett Loss') {
          return s + cents(node.amount);
        }
        return s - cents(node.amount);
      }, 0n);
    } else {
      const sumSide = roots => roots.reduce((s, node) => s + abs(cents(node.amount)), 0n);
      leftTotal = sumSide(leftRoots);
      rightTotal = sumSide(rightRoots);
      if (leftTotal !== rightTotal) {
        const balDiff = abs(leftTotal - rightTotal);
        if (leftTotal < rightTotal) {
          leftRoots.push({
            name: 'Diff. in Opening Balances',
            amount: (Number(balDiff) / 100).toFixed(2),
            children: [],
            node_type: 'calculated'
          });
          leftTotal = rightTotal;
        } else {
          rightRoots.push({
            name: 'Diff. in Opening Balances',
            amount: (Number(balDiff) / 100).toFixed(2),
            children: [],
            node_type: 'calculated'
          });
          rightTotal = leftTotal;
        }
      }
    }
    const diff = abs(leftTotal - rightTotal);

    $('#financial-tree-body').innerHTML = `
      <div class="dual">
        <section class="financial-side">
          <table class="report-table">
            <thead><tr><th>${leftTitle}</th><th class="amount">Amount</th></tr></thead>
            <tbody>${leftRoots.map(rowHtml).join('') || '<tr><td colspan="2" class="empty">No entries</td></tr>'}</tbody>
          </table>
          <div class="report-total"><span>Total</span><span>${money(leftTotal)}</span></div>
        </section>
        <section class="financial-side">
          <table class="report-table">
            <thead><tr><th>${rightTitle}</th><th class="amount">Amount</th></tr></thead>
            <tbody>${rightRoots.map(rowHtml).join('') || '<tr><td colspan="2" class="empty">No entries</td></tr>'}</tbody>
          </table>
          <div class="report-total"><span>Total</span><span>${money(rightTotal)}</span></div>
        </section>
      </div>
      ${diff > 0n ? `<div class="error" id="diff-in-books" style="margin-top:12px;font-weight:bold;">Difference in books: ${money(diff)}</div>` : ''}
    `;
  } else {
    $('#financial-tree-body').innerHTML='<table class="report-table"><thead><tr><th>Particulars</th><th class="amount">Amount</th></tr></thead><tbody>'+snapshot.roots.map(rowHtml).join('')+'</tbody></table><div class="report-total"><span>Leaf Total</span><span>'+money(cents(snapshot.totals.leaf_total))+'</span></div>';
  }
 }
 async function renderComparison(f) {
  const d=state.data, first=reportPeriod(f,d), start=first.from_date.slice(0,6), year=Number(start.slice(0,4)), month=Number(start.slice(4));
  const firstEnd=new Date(year,month,0).getDate(), nextMonth=month===12?1:month+1, nextYear=month===12?year+1:year;
  const periods=[{id:'period-a',label:new Date(year,month-1,1).toLocaleDateString('en',{month:'long'}),from:`${start}01`,to:`${start}${String(firstEnd).padStart(2,'0')}`},{id:'period-b',label:new Date(nextYear,nextMonth-1,1).toLocaleDateString('en',{month:'long'}),from:`${nextYear}${String(nextMonth).padStart(2,'0')}01`,to:`${nextYear}${String(nextMonth).padStart(2,'0')}${String(new Date(nextYear,nextMonth,0).getDate()).padStart(2,'0')}`}];
  $('#title').textContent=f.name+' Comparison';$('#screen').innerHTML='<div class="report"><div class="report-caption"><strong>'+esc(f.name)+' Comparison</strong><div class="report-meta"><b>'+esc(d.active_company)+'</b></div></div><div id="comparison-body" class="report-scroll"><div class="empty">Loading comparison...</div></div></div>';setKeys([['F2','Period','period'],['F3','Company','company'],['Ctrl+P','Print','print'],['E','Export','export'],['F12','Setting','unifiedSettings']]);
  const query=new URLSearchParams({company:d.active_company,report:f.name,periods:JSON.stringify(periods)});const result=await api('/api/compare_periods?'+query);const comparison=result.comparison;
  $('#comparison-body').innerHTML='<table class="report-table"><thead><tr><th>Particulars</th>'+comparison.columns.map(column=>`<th class="amount">${esc(column.label)}<br>Closing</th>`).join('')+'</tr></thead><tbody>'+comparison.rows.map(row=>`<tr data-row><td>${esc(row.name)}</td>${row.columns.map(column=>`<td class="amount">${money(cents(column.closing))}<br><small>${money(cents(column.movement))}</small></td>`).join('')}</tr>`).join('')+'</tbody></table>';
 }
 function financialReport(title) {const d=state.data,nominal=new Set(['Sales Accounts','Purchase Accounts','Direct Incomes','Direct Expenses','Indirect Incomes','Indirect Expenses']);let left=[],right=[];const stock=Object.values(d.stock_items).reduce((s,x)=>s+cents(x.closing_balance),0n);const openingStock=Object.values(d.stock_items).reduce((s,x)=>s+cents(title==='Profit & Loss A/c'?x.period_opening_value:x.opening_balance),0n);const movement=Object.values(d.ledgers).filter(l=>nominal.has(l.root_group)).reduce((s,l)=>s+cents(l.period_movement),0n);const profit=-movement+stock-openingStock;
 const grouped={};for(const l of Object.values(d.ledgers)){const n=l.root_group_name||l.root_group;if((title==='Profit & Loss A/c')!==nominal.has(l.root_group))continue;grouped[n]=(grouped[n]||0n)+cents(title==='Profit & Loss A/c'?l.period_movement:l.signed_closing);}
 for(const [n,a] of Object.entries(grouped)){const row={name:n,amount:abs(a),action:'groupReport',args:n};if(title==='Balance Sheet')(a<0n?left:right).push(row);else(a>0n?left:right).push(row);}
 if(title==='Balance Sheet'){if(stock)right.push({name:'Closing Stock',amount:stock,action:'report',args:'Stock Summary'});const lifetime=-Object.values(d.ledgers).filter(l=>nominal.has(l.root_group)).reduce((s,l)=>s+cents(l.signed_closing),0n)+stock-openingStock;if(lifetime)(lifetime>=0n?left:right).push({name:lifetime>=0n?'Profit & Loss A/c':'Loss',amount:abs(lifetime),action:'report',args:'Profit & Loss A/c'});}
 else {if(openingStock)left.push({name:'Opening Stock',amount:openingStock});if(stock)right.push({name:'Closing Stock',amount:stock});if(profit)(profit>=0n?left:right).push({name:profit>=0n?'Net Profit':'Net Loss',amount:abs(profit)});}
 const sum=side=>side.reduce((s,r)=>s+r.amount,0n);$('#title').textContent=title;$('#screen').innerHTML=`<div class="report"><div class="report-caption"><strong>${esc(title)}</strong><div class="report-meta"><b>${esc(d.active_company)}</b><br>${esc(shownDate(d.from_date))} to ${esc(shownDate(d.to_date))}</div></div><div class="dual">${[left,right].map((side,i)=>`<section><table class="report-table"><thead><tr><th>${title==='Balance Sheet'?(i?'Assets':'Liabilities'):(i?'Income':'Expenses')}</th><th class="amount">Amount</th></tr></thead></table><div class="report-scroll"><table class="report-table"><tbody>${side.map(r=>`<tr data-row ${r.action?`data-action="${r.action}" data-args="${esc(r.args)}"`:''}><td>${esc(r.name)}</td><td class="amount">${money(r.amount)}</td></tr>`).join('')}</tbody></table></div><div class="report-total"><span>Total</span><span>${money(sum(side))}</span></div></section>`).join('')}</div>${sum(left)!==sum(right)?`<div class="error">Difference in books: ${money(abs(sum(left)-sum(right)))}</div>`:''}</div>`;}
function renderDashboard() {$('#title').textContent='Dashboard';const d=state.data;$('#screen').innerHTML=`<div class="dashboard"><section><h2>Accounting</h2>${['Balance Sheet','Profit & Loss A/c','Trial Balance'].map(t=>`<button data-action="report" data-args="${t}">${t}</button>`).join('')}</section><section><h2>Sales</h2><b>${money(d.vouchers.filter(v=>active(v)&&v.VOUCHERTYPENAME==='Sales').reduce((s,v)=>s+amountOf(v),0n))}</b><button data-action="report" data-args="Sales Register">Sales Register</button></section><section><h2>Inventory</h2><b>${Object.keys(d.stock_items).length} Stock Items</b><button data-action="report" data-args="Stock Summary">Stock Summary</button></section><section><h2>Cash / Bank</h2><button data-action="report" data-args="Cash/Bank Book(s)">Cash/Bank Book(s)</button></section></div>`;}
function baseType(type) {return state.data.master_records.voucher_type?.[type]?.base_type||type;}
function openVoucher(type,existing) {if(!requireCompany())return;if(!type&&!existing)return choose('List of Voucher Types',state.data.voucher_types,n=>openVoucher(n));navigate({kind:'voucher',vtype:type||existing.VOUCHERTYPENAME,existing:existing?clone(existing):null});}
function collectReceiptVoucher() {const f=frame(),draft=state.draft,form=$('#edit-form'),formData=new FormData(form),v=clone(draft.original),bank=formData.get('payment_bank'),party=formData.get('party'),amount=abs(cents(formData.get('payment_amount')));if(!bank||!party||!amount)throw Error('Select the bank / cash ledger, party and receipt amount');const oldParty=listOf(draft.original).find(e=>e.LEDGERNAME===party),oldBank=listOf(draft.original).find(e=>e.LEDGERNAME===bank);Object.assign(v,{VOUCHERTYPENAME:f.vtype,VOUCHERNUMBER:formData.get('number'),DATE:formData.get('date'),PARTYLEDGERNAME:party,NARRATION:formData.get('narration'),ISOPTIONAL:formData.get('optional')?'Yes':'No'});if(formData.has('bankdate'))v.BANKDATE=formData.get('bankdate');if(formData.has('cheque'))v.CHEQUENUMBER=formData.get('cheque');v['ALLLEDGERENTRIES.LIST']=[partyAllocation(updatedRole(oldParty,party,-amount),formData),updatedRole(oldBank,bank,amount)];delete v['LEDGERENTRIES.LIST'];return v;}
function upgradeReceiptVoucher() {const form=$('#edit-form');if(!form||state.draft?.base!=='Receipt'||form.querySelector('#payment-table'))return;form.querySelector('.voucher-head [name=party]')?.closest('.field')?.remove();const table=form.querySelector('.voucher-table');if(table){table.innerHTML=paymentEditor(frame().existing||{},'Receipt');}const bank=form.querySelector('[name=payment_bank]');focusVoucherLookup(bank,{render:false});updatePaymentBalance();updateReceiptTotal();setKeys();bank?.focus();}
function updateReceiptTotal() {const el=$('#voucher-total');if(!el)return;const amount=abs(cents($('#edit-form [name=payment_amount]')?.value||0));el.textContent='Debit: '+money(amount)+'     Credit: '+money(amount);}
function renderVoucher(f) {const d=state.data,v=f.existing||{},base=baseType(f.vtype);const inventory=['Sales','Purchase','Credit Note','Debit Note',...nonAccounting].includes(base);const defaultMode=inventory&&(!f.existing||listOf(v,'ALLINVENTORYENTRIES.LIST').length||nonAccounting.has(base))?'invoice':'voucher';const mode=f.mode||defaultMode;
const accountName=listOf(v).find(e=>['Sales Accounts','Purchase Accounts'].includes(d.ledgers[e.LEDGERNAME]?.root_group))?.LEDGERNAME||'';state.draft={kind:'voucher',original:clone(v),dirty:false,mode,base,accountName};$('#title').textContent=(nonAccounting.has(base)?'Inventory':'Accounting')+' Voucher '+(f.existing?'Alteration (Secondary)':'Creation');$('#screen').innerHTML=`<form class="voucher ${f.existing?'alteration':''}" id="edit-form"><div class="voucher-band"><span class="voucher-type">${esc(f.vtype)}</span><label>No. <input name="number" aria-label="Voucher number" value="${esc(v.VOUCHERNUMBER||d.next_numbers[f.vtype]||'1')}"></label><label><input name="date" type="text" aria-label="Voucher date" value="${shownDate(v.DATE)||inputDate(keyDate(d.current_date.includes('-')?new Date().toLocaleDateString('en-CA'):d.current_date))}"></label></div><div class="voucher-head">${base==='Payment'?'':ledgerField('party','Party A/c name',v.PARTYLEDGERNAME,Object.keys(d.ledgers))}${mode==='invoice'&&!nonAccounting.has(base)?ledgerField('account',base==='Purchase'?'Purchase ledger':'Sales ledger',accountName,Object.keys(d.ledgers)):''}${mode==='invoice'&&!nonAccounting.has(base)?invoiceReferences(v):''}${f.existing&&base==='Payment'?field('cheque','Cheque No.',v.CHEQUENUMBER):''}${f.existing?field('bankdate','Bank date',v.BANKDATE,'date'):''}</div><div class="voucher-table">${mode==='invoice'?inventoryEditor(v,base):base==='Payment'?paymentEditor(v):ledgerEditor(v)}${base==='Payment'?'':'<button type="button" class="add-line" data-action="addLine">Add line</button>'}</div><div class="voucher-total" id="voucher-total"></div><div class="voucher-narration"><label for="narration">Narration:</label><textarea id="narration" name="narration">${esc(v.NARRATION||'')}</textarea><div><label><input type="checkbox" name="optional" ${v.ISOPTIONAL==='Yes'?'checked':''}> Optional</label>${v.CANCELLED==='Yes'?'<b>Cancelled</b>':''}</div></div><div class="form-actions"><button type="button" data-action="accept">Accept</button></div></form>`;
// Dates are selected by the user; creation uses today's calendar date, never a fixture.
if(!v.DATE){const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);$('#edit-form [name=date]').value=shownDate(keyDate(state.workingDate||local));}
 updateTotal();updatePaymentBalance();const firstControl=base==='Payment'?$('#edit-form [name=payment_bank]'):$('#edit-form [name=party]')||$('#edit-form [name=item]')||$('#edit-form [name=ledger]');focusVoucherLookup(firstControl,{render:false});setKeys([['F2','Date','date'],['F3','Company','company'],'gap',...standardKeys().slice(3,10),'gap',['H','Change Mode','mode'],['L','Optional','optional'],['X','Cancel Voucher','cancelVoucher'],['D','Delete','delete'],['F12','Setting','unifiedSettings']]);firstControl?.focus();}
function ledgerEditor(v) {const rows=listOf(v);return `<table id="entry-table"><thead><tr><th class="side">Dr/Cr</th><th>Particulars</th><th>Reference</th><th class="amount">Amount</th></tr></thead><tbody>${(rows.length?rows:[{},{}]).map((e,i)=>ledgerLine(e,i)).join('')}</tbody></table>`;}
function ledgerLine(e={},originalIndex=-1) {const sum=e.AMOUNT?signedEntry(e):0n;const bill=listOf(e,'BILLALLOCATIONS.LIST')[0]||{};return `<tr class="entry" data-original="${originalIndex}"><td class="side"><select name="side">${['Dr','Cr'].map(s=>`<option ${s===(sum<0n?'Cr':'Dr')?'selected':''}>${s}</option>`).join('')}</select></td><td>${ledgerSelect('ledger','Ledger',e.LEDGERNAME,Object.keys(state.data.ledgers))}</td><td><input name="bill" aria-label="Bill reference" value="${esc(bill.NAME)}"><select name="billtype" aria-label="Reference type">${['New Ref','Agst Ref','On Account','Advance'].map(s=>`<option ${s===bill.BILLTYPE?'selected':''}>${s}</option>`).join('')}</select></td><td class="amount"><input name="amount" aria-label="Amount" inputmode="decimal" value="${e.AMOUNT?decimalMoney(abs(sum)):''}"></td><td style="width:25px"><button type="button" data-action="removeLine" aria-label="Remove line">×</button></td></tr>`;}
 function inventoryEditor(v,base) {const keys=base==='Stock Journal'?['CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST']:base==='Physical Stock'?['PHYSICALSTOCKENTRIES.LIST']:['ALLINVENTORYENTRIES.LIST'];return keys.map(key=>`<div class="inventory-section" data-key="${key}">${keys.length>1?`<div class="form-heading">${key.startsWith('CONSUMPTION')?'Source (Consumption)':'Destination (Production)'}</div>`:''}<table class="inventory-table"><thead><tr><th>Name of Item</th><th>Godown</th><th class="qty">Quantity</th><th class="rate">Rate</th><th class="amount">Amount</th></tr></thead><tbody>${(listOf(v,key).length?listOf(v,key):[{}]).map(inventoryLine).join('')}</tbody></table><div class="inline-hint">Enter an item, quantity and rate; the next row opens automatically.</div></div>`).join('')+(!nonAccounting.has(base)?`<table id="extra-table"><tbody>${(listOf(v).map((e,i)=>({e,i})).filter(({e})=>e.LEDGERNAME!==v.PARTYLEDGERNAME&&e.LEDGERNAME!==state.draft.accountName&&!['CGST','SGST','IGST'].includes(e.LEDGERNAME)).map(({e,i})=>ledgerLine(e,i)).join('')||ledgerLine())}</tbody></table><button type="button" class="add-line" data-action="addLine" data-args="extra">Add Ledger Row</button><div class="inline-hint">Use ledger rows for discount, freight, delivery charges or rounding; Enter on the final completed amount saves the voucher.</div><div id="tax-preview" class="auto-tax"></div>`:'');}
function inventoryLine(e={},originalIndex=-1) {const item=state.data.stock_items[e.STOCKITEMNAME],batch=listOf(e,'BATCHALLOCATIONS.LIST')[0]||{};return `<tr class="inventory-entry" data-original="${originalIndex}"><td><select name="item" aria-label="Stock item"><option value=""></option>${Object.keys(state.data.stock_items).map(n=>`<option ${n===e.STOCKITEMNAME?'selected':''}>${esc(n)}</option>`).join('')}</select></td><td><select name="godown" aria-label="Godown"><option value=""></option>${state.data.godowns.map(n=>`<option ${n===batch.GODOWNNAME?'selected':''}>${esc(n)}</option>`).join('')}</select></td><td class="qty"><input name="qty" aria-label="Quantity" value="${esc(String(e.ACTUALQTY||e.BILLEDQTY||'').split(' ')[0])}"><span class="unit">${esc(item?.base_units||'')}</span></td><td class="rate"><input name="rate" aria-label="Rate" value="${esc(String(e.RATE||'').split('/')[0])}" inputmode="decimal"></td><td class="amount"><input name="itemamount" aria-label="Item amount" value="${e.AMOUNT?decimalMoney(abs(cents(e.AMOUNT))):''}"></td><td style="width:25px"><button type="button" data-action="removeLine" aria-label="Remove item">×</button></td></tr>`;}
function collectLedger(row,original={}) {const name=row.querySelector('[name=ledger]').value,value=row.querySelector('[name=amount]').value;if(!name&&!value)return null;if(!name||!value)throw Error('Enter ledger and amount for each line');const amount=abs(cents(value));const dr=row.querySelector('[name=side]').value==='Dr';const e={...clone(original),LEDGERNAME:name,AMOUNT:decimalMoney(dr?-amount:amount),ISDEEMEDPOSITIVE:dr?'Yes':'No'};const reference=row.querySelector('[name=bill]').value;const bills=listOf(original,'BILLALLOCATIONS.LIST'),first=bills[0]||{};const same=reference===(first.NAME||'')&&(!reference||row.querySelector('[name=billtype]').value===first.BILLTYPE)&&name===original.LEDGERNAME&&signedEntry(e)===signedEntry(original);if(!same){if(bills.length>1)throw Error('This line has multiple bill allocations. Alteration requires the full allocation editor.');if(reference)e['BILLALLOCATIONS.LIST']=[{...first,NAME:reference,BILLTYPE:row.querySelector('[name=billtype]').value,AMOUNT:e.AMOUNT}];else delete e['BILLALLOCATIONS.LIST'];}return e;}
function collectVoucher() {const f=frame(),draft=state.draft,form=$('#edit-form'),formData=new FormData(form),v=clone(draft.original);Object.assign(v,{VOUCHERTYPENAME:f.vtype,VOUCHERNUMBER:formData.get('number'),DATE:formData.get('date'),PARTYLEDGERNAME:formData.get('party'),ACCOUNTNAME:formData.get('account')||draft.accountName,NARRATION:formData.get('narration'),ISOPTIONAL:formData.get('optional')?'Yes':'No'});if(formData.has('bankdate'))v.BANKDATE=formData.get('bankdate');if(formData.has('cheque'))v.CHEQUENUMBER=formData.get('cheque');if(draft.base==='Payment'&&draft.mode==='voucher'){const bank=formData.get('payment_bank'),party=formData.get('party'),amount=abs(cents(formData.get('payment_amount')));if(!bank||!party||!amount)throw Error('Select the bank / cash ledger, party and payment amount');const oldParty=listOf(draft.original).find(e=>e.LEDGERNAME===party),oldBank=listOf(draft.original).find(e=>e.LEDGERNAME===bank);const partyEntry=partyAllocation(updatedRole(oldParty,party,amount),formData),bankEntry=updatedRole(oldBank,bank,-amount);v.PARTYLEDGERNAME=party;v['ALLLEDGERENTRIES.LIST']=[partyEntry,bankEntry];delete v['LEDGERENTRIES.LIST'];return v;}if(draft.original.MASTERID&&draft.mode==='invoice'&&!draft.accountingDirty)return v;if(draft.original.MASTERID&&draft.mode==='invoice'&&listOf(draft.original).filter(e=>['Sales Accounts','Purchase Accounts'].includes(state.data.ledgers[e.LEDGERNAME]?.root_group)).length>1)throw Error('This invoice uses multiple sales or purchase accounts. Use As Voucher mode to edit its complete postings.');
 if(['voucher','accounting_invoice'].includes(draft.mode)){v['ALLLEDGERENTRIES.LIST']=Array.from(form.querySelectorAll('#entry-table .entry')).map((r,i)=>collectLedger(r,listOf(draft.original)[Number(r.dataset.original)]||{})).filter(Boolean);delete v['LEDGERENTRIES.LIST'];for(const key of ['ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST','CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST','PHYSICALSTOCKENTRIES.LIST'])delete v[key];}
 else {let itemTotal=0n;for(const section of form.querySelectorAll('.inventory-section')){const key=section.dataset.key;v[key]=Array.from(section.querySelectorAll('.inventory-entry')).map(row=>{const name=row.querySelector('[name=item]').value,qty=row.querySelector('[name=qty]').value;if(!name&&!qty)return null;if(!name||!qty||Number(qty)<0||!Number.isFinite(Number(qty)))throw Error('Enter a stock item and valid nonnegative quantity');const amount=abs(cents(row.querySelector('[name=itemamount]').value)),unit=state.data.stock_items[name].base_units||'';itemTotal+=amount;const original=listOf(draft.original,key)[Number(row.dataset.original)]||{};const e={...clone(original),STOCKITEMNAME:name,ACTUALQTY:qty+' '+unit,BILLEDQTY:qty+' '+unit,RATE:row.querySelector('[name=rate]').value+'/'+unit,AMOUNT:decimalMoney(amount),ISDEEMEDPOSITIVE:['Purchase','Credit Note','Receipt Note','Rejections In'].includes(draft.base)?'Yes':'No'};const godown=row.querySelector('[name=godown]').value;if(original.BILLEDQTY&&qty===String(original.ACTUALQTY||'').split(' ')[0])e.BILLEDQTY=original.BILLEDQTY;else if(original.BILLEDQTY&&original.ACTUALQTY!==original.BILLEDQTY)throw Error('Actual and billed quantities differ. Edit this quantity through XML allocations.');const batches=listOf(original,'BATCHALLOCATIONS.LIST');const changed=name!==original.STOCKITEMNAME||qty!==String(original.ACTUALQTY||original.BILLEDQTY||'').split(' ')[0]||cents(e.AMOUNT)!==abs(cents(original.AMOUNT))||godown!==(batches[0]?.GODOWNNAME||'');if(changed){if(batches.length>1)throw Error('This item has multiple batch allocations. Use the allocation editor before changing quantity or value.');if(godown)e['BATCHALLOCATIONS.LIST']=[{...(batches[0]||{}),GODOWNNAME:godown,ACTUALQTY:e.ACTUALQTY,BILLEDQTY:e.BILLEDQTY,AMOUNT:e.AMOUNT}];else delete e['BATCHALLOCATIONS.LIST'];}return e;}).filter(Boolean);}
  if(!nonAccounting.has(draft.base)){const party=formData.get('party'),account=formData.get('account');if(!party||!account)throw Error('Select party and sales / purchase ledger');v.ACCOUNTNAME=account||draft.accountName;const allExtras=Array.from(form.querySelectorAll('#extra-table .entry')).map(r=>collectLedger(r,listOf(draft.original)[Number(r.dataset.original)]||{})).filter(Boolean),taxNames=new Set(['CGST','SGST','IGST']),extras=allExtras.filter(e=>!taxNames.has(e.LEDGERNAME));const sales=['Sales','Debit Note'].includes(draft.base);const accountDebit=sales?-itemTotal:itemTotal;const signedExtras=extras.reduce((s,e)=>s+signedEntry(e),0n);const taxable=abs(accountDebit)+signedExtras,taxes=(state.data.company_meta.gstin?invoiceTaxComponents(form,taxable):[]).map(t=>updatedRole(listOf(draft.original).find(e=>e.LEDGERNAME===t.ledger),t.ledger,sales?-cents(t.amount):cents(t.amount))),taxSigned=taxes.reduce((s,e)=>s+signedEntry(e),0n),partyDebit=-(accountDebit+signedExtras+taxSigned);v['ALLLEDGERENTRIES.LIST']=[partyAllocation(updatedRole(listOf(draft.original).find(e=>e.LEDGERNAME===draft.original.PARTYLEDGERNAME),party,partyDebit),formData),updatedRole(listOf(draft.original).find(e=>e.LEDGERNAME===draft.accountName),account,accountDebit),...extras,...taxes];delete v['LEDGERENTRIES.LIST'];}}
 return v;}
function updateTotal() {const el=$('#voucher-total');if(!el||!state.draft)return;try{if(state.draft.base==='Payment'){const amount=abs(cents($('#edit-form [name=payment_amount]')?.value||0));el.textContent='Debit: '+money(amount)+'     Credit: '+money(amount);return;}if(state.draft.mode==='voucher'){let dr=0n,cr=0n;for(const row of document.querySelectorAll('#entry-table .entry')){const amount=abs(cents(row.querySelector('[name=amount]').value));if(row.querySelector('[name=side]').value==='Dr')dr+=amount;else cr+=amount;}el.textContent=`Debit: ${money(dr)}     Credit: ${money(cr)}${dr!==cr?'     Difference: '+money(abs(dr-cr)):''}`;}else{let sum=0n;for(const row of document.querySelectorAll('.inventory-entry'))sum+=abs(cents(row.querySelector('[name=itemamount]').value));const extra=Array.from(document.querySelectorAll('#extra-table .entry')).reduce((total,row)=>{const amount=abs(cents(row.querySelector('[name=amount]')?.value||0));return total+(row.querySelector('[name=side]')?.value==='Cr'?-amount:amount);},0n),tax=invoiceTaxComponents($('#edit-form'),sum).reduce((total,row)=>total+cents(row.amount),0n);el.textContent='Total: '+money(sum+extra+tax);renderInvoiceTaxPreview(sum+extra);}}catch(error){el.textContent=error.message;}}
function normalizeDateControl(control) {
 if(!control||(!control.classList.contains('tally-date')&&control.name!=='date'))return;
 control.value=voucherRules.parseTallyDate(control.value||state.workingDate||state.data.current_date_iso);
}
function normalizeDateFields(form) {form?.querySelectorAll('.tally-date,[name=date]').forEach(normalizeDateControl);}
function voucherAmountForAllocation() {
 const base=state.draft?.base, form=$('#edit-form');
  if(!form||base==='Payment'||base==='Receipt')return form?.querySelector('[name=payment_amount]')?.value||'';
 if(!state.draft?.mode||state.draft.mode==='voucher')return '';
 let itemTotal=0n;
 for(const row of form.querySelectorAll('.inventory-entry'))itemTotal+=abs(cents(row.querySelector('[name=itemamount]')?.value||0));
 let extras=0n;
 for(const row of form.querySelectorAll('#extra-table .entry')){const value=abs(cents(row.querySelector('[name=amount]')?.value||0));extras+=row.querySelector('[name=side]')?.value==='Cr'?-value:value;}
 const accountDebit=['Sales','Debit Note'].includes(base)?-itemTotal:itemTotal;
 const taxes=invoiceTaxComponents(form,Number(accountDebit+extras<0n?-(accountDebit+extras):accountDebit+extras)).reduce((sum,row)=>sum+cents(row.amount),0n);
 return decimalMoney(abs(-(accountDebit+extras+(base==='Sales'||base==='Debit Note'?-taxes:taxes))));
}
async function ensureCurrentAllocation() {
 const party=$('#edit-form [name=party]')?.value, record=state.data.ledgers[party]||{};
 if(!party||String(record.is_billwise||'').toLowerCase()!=='yes')return false;
 const amount=voucherAmountForAllocation();
 if(!amount||Number(voucherRules.parseTallyAmount(amount))<=0)return false;
 if(state.draft.allocations?.ledger===party&&Number(state.draft.allocations.amount)===Number(amount))return false;
 const entry=listOf(state.draft.original).find(row=>row.LEDGERNAME===party)||{};
 await allocationDialog(party,amount,listOf(entry,'BILLALLOCATIONS.LIST'));
 return true;
}
async function accept(immediate=false) {
 if(state.busy)return;
 if(state.dialog)return state.dialog.accept?.();
 if(!state.draft)return;
 const draft=state.draft;let payload,path;
  try{
   normalizeDateFields($('#edit-form'));
   if(draft.kind==='voucher'){
    if(await ensureCurrentAllocation())return;
     payload={company:state.data.active_company,voucher:draft.base==='Receipt'?collectReceiptVoucher():collectVoucher()};
   path=frame().existing?.MASTERID?'/api/alter_voucher':'/api/create_voucher';
  }else{
   const record=Object.fromEntries(new FormData($('#edit-form')));
   if(draft.kind==='company'){
    payload={operation:draft.original.name?'Alter':'Create',company_meta:{...draft.original,...record,old_name:draft.original.name}};path='/api/save_company';
   }else{
    payload={operation:draft.original.name?'Alter':'Create',company:state.data.active_company,record:{...draft.original,...record,old_name:draft.original.name}};path='/api/save_'+draft.kind;
   }
  }
  const commit=async(allowWarning=false,warningToken=null)=>{
   if(state.busy)return;
   state.busy=true;
   try{
    const postPayload=(allowWarning&&warningToken)?{...payload,allow_inventory_warning:true,warning_token:warningToken}:payload;
    await api(path,postPayload);
    closeVoucherLookup();
    state.draft=null;delete frame().savedForm;delete frame().savedDraft;
    if(draft.kind==='company')state.period={};
    await refresh();
    if(draft.kind==='company'){state.stack=[{kind:'gateway',cursor:0}];render();}
    else if(frame().kind==='voucher'&&!frame().existing){render();}
    else{
     const parent=state.stack.at(-2),inline=parent?.inlineReturn;
     if(inline){inline.created=payload.record.name;inline.lookup=false;}
     pop();
    }
    note('Saved');
   }catch(err){
    if(err.data?.inventory?.warning_token){
     const token=err.data.inventory.warning_token;
     const warnings=err.data.inventory.warnings||[];
     const lines=warnings.map(w=>`${w.item}: Negative stock (shortage ${w.quantity}${w.godown?' in '+w.godown:''})`);
     const msg=lines.length?`${err.message}:\n${lines.join('\n')}`:err.message;
     note(err.message,true);
     showDialog('Acknowledgement',`<div class="error" style="white-space:pre-line;">${esc(msg)}</div><div class="dialog-buttons"><button data-action="confirm">OK</button><button data-action="close">Cancel</button></div>`,{
      accept:async()=>{closeDialog();await commit(true,token);}
     });
     return;
    }
    errorBox(err.message);
   }finally{state.busy=false;}
  };
  if(immediate)await commit();else confirmBox('Accept?',commit);
 }catch(error){errorBox(error.message);}
}
function showDialog(title,body,{accept=null,className='',after=null}={}) {state.dialog={accept,focus:document.activeElement};$('#dialog-title').textContent=title;$('#dialog').className=className;$('#dialog-body').innerHTML=body;$('#overlay').hidden=false;const input=$('#dialog-body input')||$('#dialog-body button');input?.focus();after?.();}
function closeDialog() {const focus=state.dialog?.focus;state.dialog=null;$('#overlay').hidden=true;$('#dialog-title').textContent='';$('#dialog-body').innerHTML='';if(focus?.isConnected)focus.focus();else $('#screen').focus();}
function openInlineMaster(select,fromLookup=false,createOption=null) {
  if(frame().kind!=='voucher'||!select)return;
  if(state.dialog)closeDialog();
  const fieldName=select.name||'party';
  const controls=Array.from(document.querySelectorAll('#edit-form [name="'+fieldName+'"]'));
  frame().inlineReturn={field:fieldName,index:controls.indexOf(select),lookup:fromLookup};
  return navigate({kind:'master',masterKind:fieldName==='item'?'stock_item':'ledger',defaultParent:createOption?.parent||''});
}
function errorBox(message) {note(message,true);showDialog('Error',`<div class="error">${esc(message)}</div><div class="dialog-buttons"><button data-action="close">OK</button></div>`);}
function confirmBox(title,onYes) {showDialog(title,'<div class="dialog-buttons"><button class="yes" data-action="confirm">Yes</button><button data-action="close">No</button></div>',{accept:async()=>{closeDialog();try{await onYes();}catch(error){errorBox(error.message);}}});}
function choose(title,items,onChoose,extra=[]) {
 const values=[...extra,...items.map(item=>typeof item==='string'?{name:item,value:item}:item)];
 const twoColumn=values.some(item=>item.detail!==undefined);
 showDialog(title,`<input class="list-search" aria-label="Search ${esc(title)}" placeholder="">${twoColumn?'<div class="lookup-head"><span>Name</span><span>Balance / Closing stock</span></div>':''}<div class="list">${values.map((item,i)=>`<button class="list-row ${i===0?'selected':''}" data-choice="${esc(item.value)}"><span>${esc(item.name)}</span>${twoColumn?`<span class="lookup-detail">${esc(item.detail||'')}</span>`:''}</button>`).join('')}</div>`,{className:twoColumn?'lookup-dialog master-lookup':'lookup-dialog',after:()=>{const input=$('#dialog-body input');input.addEventListener('input',()=>{const q=input.value.toLowerCase();for(const button of $('#dialog-body').querySelectorAll('[data-choice]'))button.hidden=!button.textContent.toLowerCase().includes(q);const visible=Array.from($('#dialog-body').querySelectorAll('[data-choice]')).filter(b=>!b.hidden);$('#dialog-body .selected')?.classList.remove('selected');visible[0]?.classList.add('selected');});state.dialog.choose=onChoose;}});
}
function companyDialog() {const choices=[{name:'Create Company',value:'__create'}];if(state.data.active_company){choices.push({name:'Alter Company',value:'__alter'},{name:'Delete Company',value:'__delete'});}choose('List of Companies',state.data.companies.map(c=>c.name),async name=>{if(name==='__create')return hasDirty()?confirmBox('Quit unfinished entries and create another company?',()=>{state.draft=null;state.stack=[{kind:'gateway',cursor:0}];navigate({kind:'companyForm'});}):navigate({kind:'companyForm'});if(name==='__alter')return state.data.active_company?navigate({kind:'companyForm',edit:true}):errorBox('Select a company first');if(name==='__delete')return action('deleteCompany');if(hasDirty())return confirmBox('Quit without saving and change company?',()=>switchCompany(name));await switchCompany(name);},choices);const previous=state.dialog.choose;state.dialog.choose=async n=>n==='__alter'?state.data.active_company?navigate({kind:'companyForm',edit:true}):errorBox('Select a company first'):n==='__delete'?action('deleteCompany'):previous(n);}
async function switchCompany(name) {await api('/api/set_company',{company:name});state.period={};state.stack=[{kind:'gateway',cursor:0}];state.draft=null;await refresh();render();note('Company selected');}
function periodDialog() {const today=keyDate(state.workingDate||state.data?.current_date_iso||state.data?.current_date||'20261015'),monthStart=today.slice(0,6)+'01',curFrom=state.period?.from||monthStart,curTo=state.period?.to||today;showDialog('Change Period',field('from','From',curFrom,'date')+field('to','To',curTo,'date')+'<div class="dialog-buttons"><button data-action="confirm">Accept</button><button data-action="close">Quit</button></div>',{accept:async()=>{let from=$('#field-from')?.value,to=$('#field-to')?.value;if(voucherRules?.parseTallyDate){try{from=voucherRules.parseTallyDate(from);}catch(e){}try{to=voucherRules.parseTallyDate(to);}catch(e){}}captureForm();if(!from||!to)throw Error('Enter both dates');const previous=state.period;state.period={from,to};try{await refresh();}catch(error){state.period=previous;throw error;}closeDialog();render();note('Period changed');}});}
function download(name,content,type='text/plain') {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('Exported '+name);}
 function dataDialog() {showDialog('Company Data','<div class="list"><button class="list-row" data-action="backup">Backup</button><button class="list-row" data-action="restore">Restore</button><button class="list-row" data-action="bulkTemplates">Bulk Templates & Import</button><button class="list-row" data-action="import">Import XML</button><button class="list-row" data-action="export">Export</button></div>');}
 function billingFieldHtml(field,index) {return `<div class="billing-field-row" data-index="${index}"><input name="billing-key" aria-label="Field key" value="${esc(field.key)}"><input name="billing-label" aria-label="Field label" value="${esc(field.label)}"><select name="billing-kind"><option ${field.kind==='item'?'selected':''}>item</option><option ${field.kind==='number'?'selected':''}>number</option><option ${field.kind==='calculated'?'selected':''}>calculated</option></select><label><input type="checkbox" name="billing-required" ${field.required?'checked':''}> Required</label><button type="button" data-action="billingRemoveField" data-args="${index}">×</button></div>`;}
 function renderBillingSettings() {const dialog=state.dialog,profile=dialog.billingProfiles[dialog.billingType],numeric=profile.fields.filter(field=>['number','calculated'].includes(field.kind)&&field.key!=='amount');$('#billing-fields').innerHTML=profile.fields.map(billingFieldHtml).join('');$('#billing-quantity-basis').innerHTML=numeric.map(field=>`<option ${field.key===profile.quantity_basis?'selected':''}>${esc(field.key)}</option>`).join('');$('#billing-formula').value=profile.formula;}
 function billingSettingsBody(profiles,type) {return `<div class="billing-settings"><div class="field"><label for="billing-type">Voucher type</label><select id="billing-type">${Object.keys(profiles).map(name=>`<option ${name===type?'selected':''}>${esc(name)}</option>`).join('')}</select></div><div class="billing-field-head"><span>Key</span><span>Label</span><span>Kind</span><span>Required</span><span></span></div><div id="billing-fields"></div><button type="button" data-action="billingAddField">Add numeric field</button><div class="field"><label for="billing-formula">Amount formula</label><input id="billing-formula" autocomplete="off"></div><div class="field"><label for="billing-quantity-basis">Quantity basis</label><select id="billing-quantity-basis"></select></div><div class="inline-hint">Allowed formula fields are the numeric row keys. Operators: +, -, *, /, %, and parentheses. The server recalculates every saved amount.</div></div><div class="dialog-buttons"><button data-action="saveBillingProfiles">Save settings</button><button data-action="close">Quit</button></div>`;}
 async function showBillingSettings() {if(!requireCompany())return;const result=await api('/api/billing_profiles?company='+encodeURIComponent(state.data.active_company));const profiles=clone(result.profiles),type=Object.keys(profiles)[0]||'Sales';showDialog('Configuration',billingSettingsBody(profiles,type),{className:'data-dialog',after:()=>{state.dialog.billingProfiles=profiles;state.dialog.billingType=type;$('#billing-type').addEventListener('change',event=>{collectBillingProfileSettings();state.dialog.billingType=event.target.value;renderBillingSettings();});renderBillingSettings();}});}
 function collectBillingProfileSettings() {const dialog=state.dialog,profile=dialog.billingProfiles[dialog.billingType];profile.fields=Array.from(document.querySelectorAll('#billing-fields .billing-field-row')).map(row=>({key:row.querySelector('[name=billing-key]').value.trim(),label:row.querySelector('[name=billing-label]').value.trim(),kind:row.querySelector('[name=billing-kind]').value,required:row.querySelector('[name=billing-required]').checked}));profile.formula=$('#billing-formula').value;profile.quantity_basis=$('#billing-quantity-basis').value;return dialog.billingProfiles;}
 async function saveBillingProfiles() {const profiles=collectBillingProfileSettings(),result=await api('/api/billing_profiles',{company:state.data.active_company,profiles,expected_revision:state.data.revision});state.data.company_meta.billing_profiles=result.profiles;closeDialog();note('Billing settings saved');}
 function importDialog(restore=false) {showDialog(restore?'Restore Company Data':'Import Data',`${restore?'':field('importcompany','Company name',state.data.active_company)+field('importstart','Financial year beginning','', 'date')+field('importend','Financial year ending','', 'date')}<div class="field"><label for="import-file">Source file(s)</label><input id="import-file" type="file" ${restore?'':'multiple'} accept="${restore?'.json':'.xml,text/xml,application/xml'}"></div><textarea id="import-text" aria-label="Import source"></textarea><div id="import-preview"></div><div class="dialog-buttons"><button data-action="preview">Preview</button><button data-action="applyImport" disabled>Import</button><button data-action="close">Quit</button></div>`,{className:'data-dialog'});state.dialog.restore=restore;state.dialog.files=[];$('#import-file').addEventListener('change',async e=>{const files=Array.from(e.target.files||[]);state.dialog.files=await Promise.all(files.map(async file=>({name:file.name,text:await file.text()})));if(files.length===1){const txt=state.dialog.files[0].text;if(txt.length<300000)$('#import-text').value=txt;else $('#import-text').value=`<!-- Loaded ${files[0].name} (${(txt.length/1024/1024).toFixed(2)} MB) -->`;const cmpMatch=txt.match(/<SVCURRENTCOMPANY>([^<]+)<\/SVCURRENTCOMPANY>/i)||txt.match(/<REMOTECMPNAME>([^<]+)<\/REMOTECMPNAME>/i);if(cmpMatch&&$('#field-importcompany')&&(!state.data.active_company||$('#field-importcompany').value===state.data.active_company))$('#field-importcompany').value=cmpMatch[1].trim();}invalidatePreview();});$('#dialog-body').addEventListener('input',event=>{if(event.target.id==='import-text')state.dialog.files=[];invalidatePreview();});}
 function invalidatePreview() {if(!state.dialog)return;state.dialog.preview=null;const button=$('[data-action=applyImport]');if(button)button.disabled=true;}
 function importPayload() {if(state.dialog.restore)return {format:'backup',data:$('#import-text').value};const files=state.dialog.files?.length?state.dialog.files:[{name:'pasted.xml',text:$('#import-text').value}];return {xmls:files,company:$('#field-importcompany').value,starting_from:$('#field-importstart').value,ending_at:$('#field-importend').value};}
 async function previewImport() {const payload=importPayload(),result=await api('/api/import_preview',payload);state.dialog.preview=JSON.stringify(payload);const skipped=(result.skipped||[]).map(item=>`Skipped ${item.name}: ${item.reason}`).join('\n');$('#import-preview').innerHTML=`<pre>${esc(`${result.companies} companies, ${result.masters} masters, ${result.vouchers} vouchers.\n${result.updated} existing vouchers updated.${skipped?'\n'+skipped:''}${result.warnings.length?'\n'+result.warnings.join('\n'):''}`)}</pre>`;$('[data-action=applyImport]').disabled=false;}
async function applyImport() {const payload=importPayload();if(state.dialog.preview!==JSON.stringify(payload))throw Error('Preview the current source before importing');const restore=state.dialog.restore;confirmBox(restore?'Replace all books with this backup?':'Import the previewed data?',async()=>{await api(restore?'/api/restore':'/api/import',payload);state.period={};state.draft=null;state.stack=[{kind:'gateway',cursor:0}];await refresh();render();note('Data saved');});}
function exportDialog() {showDialog('Export Data','<div class="list"><button class="list-row" data-action="exportExcel">Excel (.xlsx / .csv) — current report / ledger / stock</button><button class="list-row" data-action="exportPDF">PDF Document (.pdf) — formatted print</button><button class="list-row" data-action="exportXML">XML — masters and transactions</button><button class="list-row" data-action="bulkTemplates">Master Templates — bulk sheets</button><button class="list-row" data-action="backup">JSON — portable backup</button></div>');}
function selectRow(index) {const rows=Array.from($('#screen').querySelectorAll('[data-row]'));if(!rows.length)return;index=(index+rows.length)%rows.length;rows.forEach((r,i)=>r.classList.toggle('selected',i===index));frame().cursor=index;}
async function action(name,args='',element=null) {const d=state.data;const companyRequired=['create','alter','masters','master','report','dashboard','voucher','chooseLedger','chooseGroup','chooseItem','chooseBank'];if(companyRequired.includes(name)&&!requireCompany())return;switch(name){
 case 'company':return companyDialog();case 'companyForm':return navigate({kind:'companyForm'});case 'companyAlter':return navigate({kind:'companyForm',edit:true});case 'data':return dataDialog();case 'exchange':return showDialog('Exchange', '<button class="list-row" data-action="import">Import</button><button class="list-row" data-action="export">Export</button>');
   case 'lookupCreate':{const create=state.lookup?.context?.createOptions?.[Number(args)]||state.lookup?.context?.create;return openInlineMaster(state.lookup?.control,true,create);}
   case 'inlineLedger':return openInlineMaster(element?.tagName==='SELECT'?element:element?.closest('td')?.querySelector('select')||$('#edit-form [name="'+(args||'party')+'"]'));
  case 'inlineStock':return openInlineMaster(element);
  case 'create':return choose('List of Masters',Object.keys(kinds).map(k=>kinds[k]),label=>navigate({kind:'master',masterKind:Object.keys(kinds).find(k=>kinds[k]===label)}));
 case 'alter':case 'selectKind':return choose('List of Masters',Object.keys(kinds).map(k=>kinds[k]),label=>navigate({kind:'masters',masterKind:Object.keys(kinds).find(k=>kinds[k]===label)}));
  case 'masters':return navigate({kind:'masters',masterKind:args||'ledger'});case 'master':{const [kind,...parts]=args.split('|');return navigate({kind:'master',masterKind:kind,name:parts.length?parts.join('|'):null});}
  case 'menu':return navigate({kind:'menu',name:args});case 'report':return navigate({kind:args==='Ageing'?'ageing':'report',name:args});case 'comparison':return navigate({kind:'comparison',name:args||'Balance Sheet'});case 'reportDrill':return openReportDrill(args);case 'refreshAgeing':return frame().loadAgeing?.();case 'toggleFinancialDetail':frame().detailed=!frame().detailed;return render();case 'dashboard':return navigate({kind:'dashboard'});case 'ratesManager':return navigate({kind:'rates_manager'});case 'saveItemRates':return saveItemRates();
  case 'kpiReport':{const today=keyDate(state.workingDate||state.data.current_date_iso||state.data.current_date||'20261014');const monthStart=today.slice(0,6)+'01';if(args==='today_sales')return navigate({kind:'report',name:'Day Book',vtype:'Sales',period:{from:today,to:today}});if(args==='today_collections')return navigate({kind:'report',name:'Day Book',vtype:'Receipt',period:{from:today,to:today}});if(args==='month_profit')return navigate({kind:'report',name:'Profit & Loss A/c',period:{from:monthStart,to:today}});if(args==='due_from_customers')return navigate({kind:'report',name:'Receivables'});if(args==='due_to_suppliers')return navigate({kind:'report',name:'Payables'});return navigate({kind:'report',name:'Day Book'});}
  case 'unifiedSettings':return showUnifiedSettingsModal(args);case 'switchUsetTab':return showUnifiedSettingsModal(args);case 'specialThanks':return showSpecialThanksDialog();
 case 'chooseLedger':return choose('List of Ledgers',Object.keys(d.ledgers),n=>navigate({kind:'report',name:'Ledger Vouchers',ledger:n}));case 'chooseGroup':return choose('List of Groups',d.groups,n=>navigate({kind:'report',name:'Group Summary',group:n}));case 'chooseItem':return choose('List of Stock Items',Object.keys(d.stock_items),n=>navigate({kind:'report',name:'Stock Item Vouchers',item:n}));case 'chooseBank':return choose('List of Bank Ledgers',Object.keys(d.ledgers).filter(n=>['Bank Accounts','Bank OCC A/c','Bank OD A/c'].includes(d.ledgers[n].group_type||d.ledgers[n].parent)),n=>navigate({kind:'report',name:'Bank Reconciliation',ledger:n}));
 case 'toggleLedgerWise':frame().ledgerWise=!frame().ledgerWise;return render();case 'ledgerSummary':return navigate({kind:'report',name:frame().name==='Ledger Monthly Summary'?'Ledger Vouchers':'Ledger Monthly Summary',ledger:frame().ledger});case 'ledgerMonth':{const [ledger,month]=args.split('|');return navigate({kind:'report',name:'Ledger Vouchers',ledger,month});}case 'ledgerReport':return navigate({kind:'report',name:'Ledger Vouchers',ledger:args});case 'groupReport':return navigate({kind:'report',name:'Group Summary',group:args});case 'itemReport':return navigate({kind:'report',name:'Stock Item Vouchers',item:args});case 'register':return navigate({kind:'report',name:'Voucher Register',vtype:args});case 'month':{const [type,month]=args.split('|');return navigate({kind:'report',name:'Voucher Register',vtype:type,month});}
 case 'voucher':case 'types':if(frame().kind==='voucher'&&state.draft?.dirty)return confirmBox('Quit without saving?',()=>{state.stack.pop();state.draft=null;openVoucher(name==='types'?'':args);});if(frame().kind==='voucher'){state.stack.pop();state.draft=null;}return openVoucher(name==='types'?'':args);
  case 'editVoucher':return openVoucher('',d.vouchers.find(v=>v.MASTERID===args));case 'accept':return accept(args==='immediate');case 'confirm':return accept();case 'back':return back();case 'quit':return confirmBox(hasDirty()?'Quit without saving unfinished entries?':'Quit?',()=>{state.stack=[{kind:'gateway',cursor:0}];state.draft=null;render();note('Books remain saved. You may close this window.');});case 'close':return closeDialog();case 'period':return periodDialog();
  case 'date':if(frame().kind==='voucher')return $('#edit-form [name=date]').focus();if(frame().kind==='gateway')return workingDateDialog();return periodDialog();case 'mode':if(frame().kind!=='voucher')return;return showVoucherModeDialog();
 case 'addLine':{const body=args==='extra'?$('#extra-table tbody'):args?$('.inventory-section[data-key="'+args+'"] tbody'):$('#entry-table tbody')||$('.inventory-table tbody');body.insertAdjacentHTML('beforeend',args==='extra'||$('#entry-table')?ledgerLine():inventoryLine());state.draft.dirty=true;state.draft.accountingDirty=true;return;}
 case 'removeLine':element.closest('tr').remove();state.draft.dirty=true;state.draft.accountingDirty=true;return updateTotal();case 'optional':{const check=$('[name=optional]');if(check){check.checked=!check.checked;state.draft.dirty=true;}return;}
 case 'deleteCompany':{const compName=state.draft?.original?.name||d.active_company;if(!compName)return errorBox('Select a company first');return confirmBox(`Delete company "${compName}"?\nAll vouchers, ledgers and reports for this company will be deleted.`,()=>{confirmBox(`Are you sure you want to permanently delete "${compName}"? This cannot be undone.`,async()=>{await api('/api/delete_company',{company:compName});state.draft=null;state.period={};state.stack=[{kind:'gateway',cursor:0}];await refresh();render();note(`Company "${compName}" deleted`);});});}
 case 'delete':case 'cancelVoucher':{if(frame().kind==='companyForm'&&frame().edit)return action('deleteCompany');const v=frame().existing;if(!v)return note('Open an existing voucher first');return confirmBox(name==='delete'?'Delete voucher?':'Cancel voucher?',async()=>{await api(name==='delete'?'/api/delete_voucher':'/api/cancel_voucher',{company:d.active_company,voucher_id:v.MASTERID});await refresh();state.draft=null;pop();note(name==='delete'?'Voucher deleted':'Voucher cancelled');});}
 case 'goto':return choose('Go To',[...Object.keys(menus),'Balance Sheet','Profit & Loss A/c','Trial Balance','Day Book','Stock Summary','Sales Register','Purchase Register','Receivables','Payables','Statistics','Dashboard','Vouchers','Chart of Accounts'],n=>action(n==='Vouchers'?'voucher':n==='Dashboard'?'dashboard':n==='Chart of Accounts'?'masters':menus[n]?'menu':'report',n));
 case 'backup':{closeDialog();const backup=await api('/api/export');return download('books-backup.json',JSON.stringify(backup,null,2),'application/json');}case 'restore':return importDialog(true);case 'bulkTemplates':return showBulkTemplatesDialog();case 'import':return importDialog(false);case 'preview':return previewImport();case 'applyImport':return applyImport();case 'export':return exportDialog();case 'exportXML':{if(!d.active_company)throw Error('Select a company first');const response=await fetch('/api/export_xml?company='+encodeURIComponent(d.active_company));if(!response.ok)throw Error('Export failed');closeDialog();return download('company.xml',await response.text(),'application/xml');}
  case 'exportExcel':{closeDialog();const tables=Array.from($('#screen').querySelectorAll('table'));if(!tables.length)throw Error('Open a report to export');let csvContent='\uFEFF';tables.forEach((t,tIdx)=>{if(tIdx>0)csvContent+='\r\n\r\n';const rows=Array.from(t.querySelectorAll('tr'));rows.forEach(r=>{const cells=Array.from(r.querySelectorAll('th, td')).map(c=>'"'+(c.textContent||'').trim().replaceAll('"','""')+'"');csvContent+=cells.join(',')+'\r\n';});});const repName=(frame().name||frame().kind||'Report').replace(/[^a-zA-Z0-9_\-]/g,'_');return download(repName+'.csv',csvContent,'text/csv;charset=utf-8;');}
  case 'exportPDF':{closeDialog();if(frame().kind==='voucher')return showPrintOverlay();return window.print();}
  case 'exportCSV':{closeDialog();const tables=Array.from($('#screen').querySelectorAll('table'));if(!tables.length)throw Error('Open a report to export');let csvContent='\uFEFF';tables.forEach((t,tIdx)=>{if(tIdx>0)csvContent+='\r\n\r\n';const rows=Array.from(t.querySelectorAll('tr'));rows.forEach(r=>{const cells=Array.from(r.querySelectorAll('th, td')).map(c=>'"'+(c.textContent||'').trim().replaceAll('"','""')+'"');csvContent+=cells.join(',')+'\r\n';});});const repName=(frame().name||frame().kind||'Report').replace(/[^a-zA-Z0-9_\-]/g,'_');return download(repName+'.csv',csvContent,'text/csv;charset=utf-8;');}
 case 'exportHTML':{closeDialog();if(!$('.report'))throw Error('Open a report to export');return download('report.html','<!doctype html><meta charset="utf-8"><title>'+esc($('#title').textContent)+'</title><style>body{font:13px Arial}table{width:100%;border-collapse:collapse}td,th{padding:5px;border-bottom:1px solid #ddd}.amount{text-align:right}.dual{display:flex}.dual>section{width:50%}</style>'+$('.report').outerHTML,'text/html');}
 case 'print':if(frame().kind==='voucher')return showPrintOverlay();return window.print();
case 'doPrintDirect':closeDialog();return window.print();
case 'doPrintPreview':return openPrintPreview();
case 'doPrintConfigure':return openPrintConfigure();
case 'savePrintConfig':return savePrintConfig();
case 'closePrintPreview':return closePrintPreview();
case 'doPrintFromPreview':closePrintPreview();return window.print();
case 'doPrintConfigureFromPreview':closePrintPreview();return openPrintConfigure();case 'share':return showDialog('Share','<button class="list-row" data-action="exportHTML">Save current report as HTML</button><button class="list-row" data-action="exportCSV">Save current report as CSV</button>');
  case 'configure':return handleContextualConfigure();case 'billingAddField':{collectBillingProfileSettings();const type=state.dialog.billingType,profile=state.dialog.billingProfiles[type],index=profile.fields.length;profile.fields.splice(-1,0,{key:'field_'+index,label:'New Field',kind:'number',required:false});return renderBillingSettings();}case 'billingRemoveField':{collectBillingProfileSettings();const profile=state.dialog.billingProfiles[state.dialog.billingType],index=Number(args);if(profile.fields[index]?.kind==='calculated')return errorBox('The calculated amount field cannot be removed');profile.fields.splice(index,1);return renderBillingSettings();}case 'saveBillingProfiles':return saveBillingProfiles();
 case 'basis':return note(`Period: ${shownDate(d.from_date)} to ${shownDate(d.to_date)}. Stock uses moving weighted average cost.`);case 'view':return action('report',frame().name==='Trial Balance'?'Balance Sheet':'Trial Balance');case 'capability':return errorBox(args==='TallyCapital'?'TallyCapital is an external service and is not connected in this independent application.':args+' filing and statutory calculation are not implemented.');case 'checkUpdate':{try{const res=await api('/api/check_update');note(`${res.changelog} (Version ${res.current_version})`);}catch(e){note(e.message,true);}return;}
case 'help':return showDialog('Help','<p>Arrow keys select. Enter opens. Esc returns to the previous screen.</p><p>Ctrl+A accepts. Alt+G opens Go To. F2 changes period/date. F3 selects company. F4–F9 select vouchers.</p><p>Data → Backup saves all companies. Import previews XML before committing.</p><div style="margin:12px 0; padding:10px 14px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; font-size:12px;"><div style="font-weight:700; color:#047857; margin-bottom:4px;">Author & Support Inquiries:</div><div>Email: <a href="mailto:mossoassistant@gmail.com" target="_blank" style="color:#059669; font-weight:600; text-decoration:none;">mossoassistant@gmail.com</a></div><div style="margin-top:4px;">Instagram: <a href="https://www.instagram.com/wilde_sahil/" target="_blank" style="color:#d946ef; font-weight:600; text-decoration:none;">@wilde_sahil</a></div></div><div style="margin:12px 0;"><button type="button" class="list-row" data-action="checkUpdate">Check for Updates</button></div><div class="dialog-buttons"><button data-action="close">Close</button></div>');
}}
// Native Desktop Experience: Disable browser right-click context menu
document.addEventListener('contextmenu', event => {
  event.preventDefault();
});

// Disable browser Developer Tools and reload shortcuts
document.addEventListener('keydown', event => {
  if (
    (event.ctrlKey && event.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(event.key)) ||
    (event.ctrlKey && ['u', 'U', 'r', 'R'].includes(event.key)) ||
    (event.key === 'F5')
  ) {
    event.preventDefault();
  }
});

 document.addEventListener('click',async event=>{const trendBtn=event.target.closest('button[data-trend]');if(trendBtn){event.preventDefault();state.activeTrendSpan=trendBtn.dataset.trend;document.querySelectorAll('.trend-toggles button').forEach(b=>b.classList.toggle('active',b.dataset.trend===state.activeTrendSpan));const m=state.dashboardMetrics;if(m&&m.trend){const chartEl=document.querySelector('.trend-chart');if(chartEl)chartEl.innerHTML=renderTrendSvg(m.trend[state.activeTrendSpan]||[],state.activeTrendSpan);}return;}const floatingOpt=event.target.closest('.floating-option');if(floatingOpt&&frame().kind==='voucher'){event.preventDefault();return selectVoucherLookup(floatingOpt.dataset.lookupValue);}const floatingDropdown=document.getElementById('floating-lookup-dropdown');if(floatingDropdown&&!floatingDropdown.contains(event.target)&&!isVoucherLookupControl(event.target)&&!event.target.closest('.voucher-lookup-panel')&&!event.target.closest('#keys')){closeVoucherLookup();}const allocation=event.target.closest('[data-action="allocationContinue"]');if(allocation){event.preventDefault();event.stopImmediatePropagation();try{await commitAllocationDialog();}catch(error){errorBox(error.message);}return;}const lookupOption=event.target.closest('[data-lookup-value]');if(lookupOption&&frame().kind==='voucher'){event.preventDefault();return selectVoucherLookup(lookupOption.dataset.lookupValue);}const choice=event.target.closest('[data-choice]');if(choice){const callback=state.dialog?.choose,name=choice.dataset.choice;closeDialog();try{await callback?.(name);}catch(error){errorBox(error.message);}return;}const el=event.target.closest('[data-action]');if(!el||el.disabled)return;event.preventDefault();try{await action(el.dataset.action,el.dataset.args||'',el);}catch(error){errorBox(error.message);}});
 document.addEventListener('input',event=>{if(event.target.id==='voucher-lookup-search'&&state.lookup){refreshVoucherLookup(event.target.value);return;}if(event.target.closest('#edit-form')&&state.draft){state.draft.dirty=true;if(!['narration','date','number','optional','cheque','bankdate'].includes(event.target.name))state.draft.accountingDirty=true;if(event.target.closest('.inventory-entry')&&['qty','rate'].includes(event.target.name)){const row=event.target.closest('tr'),q=Number(row.querySelector('[name=qty]').value),r=Number(row.querySelector('[name=rate]').value);if(Number.isFinite(q*r))row.querySelector('[name=itemamount]').value=productMoney(row.querySelector('[name=qty]').value,row.querySelector('[name=rate]').value);}updateTotal();}});
 document.addEventListener('change',event=>{if(event.target.closest('#edit-form')&&state.draft){state.draft.dirty=true;if(!['narration','date','number','optional','cheque','bankdate'].includes(event.target.name))state.draft.accountingDirty=true;if(event.target.name==='item'){const item=state.data.stock_items[event.target.value];const row=event.target.closest('tr');if(row){const u=row.querySelector('.unit');if(u)u.textContent=item?.base_units||'';const base=state.draft?.base;const isSales=['Sales','Credit Note','Delivery Note'].includes(base);const isPurchase=['Purchase','Debit Note','Receipt Note'].includes(base);const stdRate=isSales?item?.standard_selling_rate:(isPurchase?item?.standard_purchase_rate:'');const rateInput=row.querySelector('[name=rate]');if(rateInput&&stdRate){rateInput.value=stdRate;const qtyInput=row.querySelector('[name=qty]');const q=Number(qtyInput?.value||0), r=Number(stdRate);if(Number.isFinite(q*r)&&q>0){const amtInput=row.querySelector('[name=itemamount]');if(amtInput)amtInput.value=productMoney(qtyInput.value,stdRate);}if(typeof updateBillingRow==='function')updateBillingRow(row);}}}if(event.target.name==='party')updatePaymentBalance();updateTotal();}});
 document.addEventListener('input',event=>{if(state.draft?.base==='Receipt'&&event.target.closest('#payment-table'))updateReceiptTotal();});
 document.addEventListener('change',event=>{if(state.draft?.base==='Receipt'&&event.target.closest('#payment-table'))updateReceiptTotal();});
document.addEventListener('submit',event=>{event.preventDefault();accept();});
document.addEventListener('keydown',event=>{
 const target=event.target;
 if(!target||(!target.classList?.contains('tally-date')&&target.name!=='date'))return;
 try{
  if(event.key==='+'||event.key==='-'){
   event.preventDefault();
   target.value=voucherRules.stepTallyDate(target.value||state.workingDate||state.data.current_date_iso,event.key==='+'?1:-1);
   target.dispatchEvent(new Event('input',{bubbles:true}));
  }else if(event.key==='Enter'){
   normalizeDateControl(target);
  }
 }catch(error){event.preventDefault();errorBox(error.message);}
},true);
 document.addEventListener('keydown',async event=>{
  if(event.key!=='Enter'||event.target?.name!=='payment_amount')return;
  const party=$('#edit-form [name=party]')?.value;
  const ledger=state.data.ledgers[party]||{};
  if(party&&String(ledger.is_billwise||'').toLowerCase()==='yes'&&Number(voucherRules.parseTallyAmount(event.target.value))>0){
   event.preventDefault();event.stopImmediatePropagation();
   try{await maybeOpenAllocation();}catch(error){errorBox(error.message);}
  }
 },true);
 document.addEventListener('focusin',event=>{
  if(['INPUT','TEXTAREA'].includes(event.target.tagName)&&typeof event.target.select==='function'&&event.target.type!=='button'){
   setTimeout(()=>event.target.select(),10);
  }
  if(isVoucherLookupControl(event.target))focusVoucherLookup(event.target);
  else if(!event.target.closest('.voucher-lookup-panel')&&!event.target.closest('#floating-lookup-dropdown')&&!event.target.closest('#keys')){closeVoucherLookup();}
 });
 document.addEventListener('keydown',async event=>{
  if(event.target.closest('#calculator-pane'))return;
  if(frame().kind!=='voucher')return;
  const key=event.key;
  if(event.target.closest('.voucher-lookup-panel')){
   if(key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeVoucherLookup();return;}
   if(key==='ArrowDown'||key==='ArrowUp'){
    event.preventDefault();event.stopImmediatePropagation();
    moveLookupCursor(key==='ArrowDown'?1:-1);
    if(event.target.id==='voucher-lookup-search')$('#voucher-lookup-search')?.focus();
    return;
   }
   if(key==='Enter'){
    const createBtn=event.target.closest('.lookup-create');
    if(createBtn){
     event.preventDefault();event.stopImmediatePropagation();
     return action(createBtn.dataset.action,createBtn.dataset.args||'',createBtn);
    }
    event.preventDefault();event.stopImmediatePropagation();return selectLookupCursor();
   }
   return;
  }
  if(isVoucherLookupControl(event.target)){
   if(key==='Escape'){
    if(state.lookup){
     event.preventDefault();event.stopImmediatePropagation();closeVoucherLookup();return;
    }
   }
   if(key==='ArrowDown'||key==='ArrowUp'){
    event.preventDefault();event.stopImmediatePropagation();
    moveLookupCursor(key==='ArrowDown'?1:-1);
    return;
   }
   if(key==='Enter'){
    event.preventDefault();event.stopImmediatePropagation();
    return selectLookupCursor();
   }
   if(key==='Backspace'){
    if(state.lookup&&state.lookup.query){
     event.preventDefault();event.stopImmediatePropagation();
     refreshVoucherLookup(state.lookup.query.slice(0,-1));
     return;
    }
   }
   if(key.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
    if(state.lookup){
     event.preventDefault();event.stopImmediatePropagation();
     refreshVoucherLookup((state.lookup.query||'')+key);
     return;
    }
   }
  }
  if(event.target.closest('#extra-table')&&event.target.name==='amount'&&key==='Enter'){
   const row=event.target.closest('.entry');
   const table=event.target.closest('#extra-table');
   const entries=Array.from(table.querySelectorAll('.entry'));
   const isFinalRow=(entries[entries.length-1]===row);
   if(isFinalRow){
    if(row?.querySelector('[name=ledger]')?.value&&event.target.value){event.preventDefault();event.stopImmediatePropagation();return accept(true);}
   }else{
    event.preventDefault();event.stopImmediatePropagation();
    const nextRow=entries[entries.indexOf(row)+1];
    const nextLedger=nextRow?.querySelector('[name=ledger]');
    if(nextLedger){setTimeout(()=>nextLedger.focus(),50);return;}
    return focusNextControl(event.target);
   }
  }
 },true);
   document.addEventListener('keydown',async event=>{
  if(event.target.closest('#calculator-pane'))return;
  const key=event.key.toLowerCase();
    const previewModal = document.getElementById('invoice-preview-overlay');
    if(previewModal){
      if(key==='escape'){event.preventDefault();event.stopImmediatePropagation();return closePrintPreview();}
      if(key==='p'){event.preventDefault();event.stopImmediatePropagation();closePrintPreview();return window.print();}
      if(key==='c'){event.preventDefault();event.stopImmediatePropagation();closePrintPreview();return openPrintConfigure();}
    }
    if(state.dialog?.isPrintDialog){
      if(key==='p'||key==='enter'){event.preventDefault();event.stopImmediatePropagation();return action('doPrintDirect');}
      if(key==='i'){event.preventDefault();event.stopImmediatePropagation();return action('doPrintPreview');}
      if(key==='c'){event.preventDefault();event.stopImmediatePropagation();return action('doPrintConfigure');}
    }
  try{
    const inline=state.dialog?.select||event.target;
   if(event.altKey&&key==='c'&&frame().kind==='voucher'&&['party','account','ledger','payment_bank','item'].includes(inline.name)){
    event.preventDefault();event.stopImmediatePropagation();return openInlineMaster(inline,Boolean(state.dialog?.select));
   }
   if(state.dialog){
     if(event.ctrlKey&&key==='a'&&state.dialog.accept){event.preventDefault();event.stopImmediatePropagation();event.independentHandled=true;normalizeDateFields($('#dialog-body'));await state.dialog.accept();}
    return;
   }
   if(event.ctrlKey&&key==='h'&&frame().kind==='voucher'){
    event.preventDefault();event.stopImmediatePropagation();return action('mode');
   }
    if(key==='f3'||key==='f12'){
     event.preventDefault();event.stopImmediatePropagation();return action(key==='f3'?'company':'configure');
    }
    if(frame().kind==='report'&&['Balance Sheet','Profit & Loss A/c'].includes(frame().name)&&event.altKey&&(key==='f1'||key==='f5')){
     event.preventDefault();event.stopImmediatePropagation();frame().detailed=!frame().detailed;return render();
    }
  }catch(error){errorBox(error.message);}
 },true);
 document.addEventListener('keydown',async event=>{try{
  if(event.target.closest('#calculator-pane'))return;
  const key=event.key;if(state.dialog){if(key==='Escape'){event.preventDefault();closeDialog();return;}if(key==='Tab'){const focusables=Array.from($('#dialog-body').querySelectorAll('input,button,select,textarea')).filter(x=>!x.disabled&&!x.hidden&&x.offsetParent!==null);if(focusables.length){const i=focusables.indexOf(document.activeElement),next=(i+(event.shiftKey?-1:1)+focusables.length)%focusables.length;event.preventDefault();focusables[next].focus();}return;}if(['ArrowDown','ArrowUp'].includes(key)){const rows=Array.from($('#dialog-body').querySelectorAll('[data-choice]')).filter(x=>!x.hidden);if(rows.length){const i=rows.findIndex(x=>x.classList.contains('selected'));rows[i]?.classList.remove('selected');const next=rows[(i+(key==='ArrowDown'?1:-1)+rows.length)%rows.length];next.classList.add('selected');next.scrollIntoView({block:'nearest'});event.preventDefault();}return;}if(key==='Enter'){event.preventDefault();const chosen=$('#dialog-body [data-choice].selected');if(chosen)chosen.click();else if(state.dialog.accept)await state.dialog.accept();else document.activeElement?.click();return;}return;}
 const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName);if(key==='Escape'){if(state.calculator){event.preventDefault();return closeCalculator();}event.preventDefault();back();return;}if(event.ctrlKey&&key.toLowerCase()==='p'){event.preventDefault();return action('print');}
if(event.ctrlKey&&key.toLowerCase()==='n'&&editing){event.preventDefault();return openCalculator();}if(state.calculator&&event.ctrlKey&&key.toLowerCase()==='m'){event.preventDefault();return closeCalculator();}if(event.ctrlKey&&key.toLowerCase()==='r'&&event.target.name==='narration'&&frame().kind==='voucher'){event.preventDefault();const params=new URLSearchParams({company:state.data.active_company,voucher_type:frame().vtype||state.draft.base});if(frame().existing?.MASTERID)params.set('exclude',frame().existing.MASTERID);try{const result=await api('/api/last_narration?'+params);if(result.narration)event.target.value=result.narration;}catch(error){note(error.message,true);}return;}if(event.ctrlKey&&key.toLowerCase()==='a'){event.preventDefault();return action('accept','immediate');}if(key==='F2'){event.preventDefault();return action(event.altKey?'period':'date');}if(key==='F3'){event.preventDefault();return action(event.altKey?'companyAlter':'company');}if(key==='F12'){event.preventDefault();return action('unifiedSettings');}if(event.altKey&&key.toLowerCase()==='c'&&editing&&['party','account','ledger'].includes(event.target.name)){event.preventDefault();return action('inlineLedger',event.target.name,event.target);}if(event.altKey&&key.toLowerCase()==='c'&&editing&&event.target.name==='item'){event.preventDefault();return action('inlineStock','item',event.target);}if(event.ctrlKey&&key==='Enter'){const selected=$('#screen [data-row].selected');if(selected?.dataset.action==='ledgerReport'){event.preventDefault();return navigate({kind:'master',masterKind:'ledger',name:selected.dataset.args});}if(selected?.dataset.action==='groupReport'){event.preventDefault();return navigate({kind:'master',masterKind:'group',name:selected.dataset.args});}}if(event.altKey){const actions={g:'goto',k:'company',y:'data',o:'import',e:'export',p:'print',d:'delete',t:'specialThanks'};if(actions[key.toLowerCase()]){event.preventDefault();return action(actions[key.toLowerCase()]);}}
if(/^F[4-9]$/.test(key)){event.preventDefault();const contextual=$('#keys [data-shortcut="'+key+'"]');if(contextual)return action(contextual.dataset.action,contextual.dataset.args||'');return action('voucher',['Contra','Payment','Receipt','Journal','Sales','Purchase'][Number(key.slice(1))-4]);}if(key==='F10'){event.preventDefault();return action('types');}if(key==='F1'){event.preventDefault();return action('help');}
  if(!editing&&frame().kind==='gateway'&&!event.ctrlKey&&!event.altKey){const options={c:['create'],a:['alter'],h:['masters','ledger'],v:['voucher'],k:['report','Day Book'],n:['menu','Banking'],b:['report','Balance Sheet'],p:['report','Profit & Loss A/c'],s:['report','Stock Summary'],r:['report','Ratio Analysis'],d:['menu','Display More Reports'],o:['dashboard'],q:['quit'],t:['specialThanks']};if(options[key.toLowerCase()]){event.preventDefault();return action(...options[key.toLowerCase()]);}}if(editing){if(key==='Backspace'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();return focusPreviousControl(event.target);}if(key==='Enter'){if(event.target.tagName==='TEXTAREA'||event.target.name==='narration'){if(event.shiftKey)return;event.preventDefault();return accept();}event.preventDefault();if(event.target.tagName==='SELECT'){const inventoryRow=event.target.closest('.inventory-entry'),section=event.target.closest('.inventory-section');if(inventoryRow&&section&&!event.target.value&&inventoryRow===section.querySelector('.inventory-entry:last-child')){const extra=$('#extra-table [name=ledger]');if(extra){extra.focus();return;}}if(voucherRules.shouldAdvanceSelect(event.target))return focusNextControl(event.target);return chooseSelect(event.target);}if(event.target.closest('.inventory-entry')&&['rate','itemamount'].includes(event.target.name)&&ensureInvoiceRow(event.target.closest('.inventory-section')))return;if(event.target.closest('#extra-table')&&event.target.name==='amount'&&ensureExtraLedgerRow())return;return focusNextControl(event.target);}return;}if(['ArrowDown','ArrowUp'].includes(key)){event.preventDefault();selectRow((frame().cursor||0)+(key==='ArrowDown'?1:-1));$('#screen .selected')?.scrollIntoView({block:'nearest'});}if(key==='Enter'){event.preventDefault();$('#screen [data-row].selected')?.click();}
}catch(error){errorBox(error.message);}});
window.addEventListener('beforeunload',event=>{if(hasDirty()){event.preventDefault();event.returnValue='';}});
refresh().then(render).catch(error=>errorBox(error.message));

function captureForm() {
 if(!state.draft||!$('#edit-form'))return;
 const source=$('#screen'),copy=source.cloneNode(true);
 const actual=source.querySelectorAll('input,select,textarea'),controls=copy.querySelectorAll('input,select,textarea');
 actual.forEach((control,i)=>{const target=controls[i];if(control.tagName==='SELECT')Array.from(target.options).forEach((o,j)=>{if(control.options[j].selected)o.setAttribute('selected','');else o.removeAttribute('selected');});else if(control.tagName==='TEXTAREA')target.textContent=control.value;else{target.setAttribute('value',control.value);if(control.checked)target.setAttribute('checked','');else target.removeAttribute('checked');}});
 frame().savedForm=copy.innerHTML;frame().savedDraft=clone(state.draft);
}
function refreshSelects() {
  for(const select of $('#edit-form').querySelectorAll('[name=ledger],[name=party],[name=account],[name=payment_bank]')){
  const value=select.value,names=select.name==='payment_bank'?cashBankNames():select.name==='party'&&state.draft.base==='Payment'?paymentPartyNames():Object.keys(state.data.ledgers);select.innerHTML='<option value=""></option>'+names.map(n=>'<option '+(n===value?'selected':'')+'>'+esc(n)+'</option>').join('');
 }
 for(const select of $('#edit-form').querySelectorAll('[name=item]')){
  const value=select.value;select.innerHTML='<option value=""></option>'+Object.keys(state.data.stock_items).map(n=>'<option '+(n===value?'selected':'')+'>'+esc(n)+'</option>').join('');
 }
}
function productMoney(quantity,rate) {
 const parse=s=>{s=String(s||0);if(!/^\d+(\.\d+)?$/.test(s))throw Error('Enter a valid quantity and rate');const [a,b='']=s.split('.');return {n:BigInt(a+b),scale:10n**BigInt(b.length)};};
 const q=parse(quantity),r=parse(rate),div=q.scale*r.scale;return decimalMoney((q.n*r.n*100n+div/2n)/div);
}

function updatedRole(original,name,amount) {
 const e={...clone(original||{}),LEDGERNAME:name,ISDEEMEDPOSITIVE:amount>=0n?'Yes':'No',AMOUNT:decimalMoney(-amount)};
 const allocations=listOf(original||{},'BILLALLOCATIONS.LIST');
 if(allocations.length&&(!original||signedEntry(original)!==amount||name!==original.LEDGERNAME)){
  if(allocations.length>1)throw Error('This party has multiple bill allocations. Edit allocations before changing its amount.');
  e['BILLALLOCATIONS.LIST']=[{...allocations[0],AMOUNT:e.AMOUNT}];
 }
 return e;
}
function hasDirty() {return Boolean(state.draft?.dirty||state.stack.some(f=>f.savedDraft?.dirty));}

function workingDateDialog() {
 showDialog('Change Current Date',field('workingdate','Current date',state.workingDate||state.data.current_date_iso,'date')+'<div class="dialog-buttons"><button data-action="confirm">Accept</button><button data-action="close">Quit</button></div>',{accept:()=>{const date=$('#field-workingdate').value;if(!date)throw Error('Enter a valid date');state.workingDate=date;closeDialog();render();}});
}
function chooseSelect(select) {
  const options=Array.from(select.options).filter(o=>o.value).map(o=>o.value);
   const master= ['ledger','party','account','payment_bank'].includes(select.name)||select.name==='item';
   const items=master?options.map(value=>{
    if(select.name==='item'){
     const item=state.data.stock_items[value]||{};
     return {name:value,value,detail:`${item.closing_qty||item.opening_qty||'0'} ${item.base_units||''}`.trim()};
    }
    const balance=voucherRules.balanceFromLedger(state.data.ledgers[value]);
    return {name:value,value,detail:`${money(cents(balance.amount))} ${balance.drcr}`};
   }):options;
   const extra=master?[{name:'Create',value:'__create',detail:''}]:[];
   choose(select.labels?.[0]?.textContent?.replace(':','').trim()||select.getAttribute('aria-label')||'List of Values',items,value=>{
    if(value==='__create')return openInlineMaster(select,true);
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));select.focus();
   },extra);
   state.dialog.select=select;
}
document.addEventListener('mousedown',event=>{if(event.target.tagName==='SELECT'&&event.target.closest('#edit-form')){if(frame().kind==='voucher'&&isVoucherLookupControl(event.target)){event.preventDefault();event.target.focus();focusVoucherLookup(event.target);return;}event.preventDefault();chooseSelect(event.target);}});

function currentDateText(iso) {if(!iso)return '';const date=new Date(iso+'T12:00:00');return date.toLocaleDateString('en',{weekday:'long'})+', '+Number(iso.slice(8))+'-'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(iso.slice(5,7))-1]+'-'+iso.slice(0,4);}

async function openReportDrill(raw) {
 const context=typeof raw==='string'?JSON.parse(raw):raw;
 if(context.company!==state.data.active_company)throw Error('Report context belongs to another company');
 if(!context.period?.from||!context.period?.to)throw Error('Report context has no period');
 state.period={from:context.period.from,to:context.period.to};
 await refresh();
 if(context.node_type==='calculated') {
   if(context.drill_name) return navigate({kind:'report',name:context.drill_name,period:context.period,drillContext:context});
   return;
 }
 navigate({kind:'report',name:context.node_type==='group'?'Group Summary':'Ledger Monthly Summary',
            group:context.node_type==='group'?context.name:undefined,
            ledger:context.node_type==='ledger'?context.name:undefined,
            period:context.period,drillContext:context});
}

 function reportPeriod(f,d) {
  if(f.period)return {from_date:date_key_ui(f.period.from),to_date:date_key_ui(f.period.to)};
  if(!f.month)return {from_date:d.from_date,to_date:d.to_date};
 const year=Number(f.month.slice(0,4)),month=Number(f.month.slice(4));
 const first=f.month+'01',last=f.month+String(new Date(year,month,0).getDate());
 return {from_date:first>d.from_date?first:d.from_date,to_date:last<d.to_date?last:d.to_date};
}
function ledgerWindow(d,name,period) {
 const movements=d.vouchers.filter(v=>active(v)&&!nonAccounting.has(baseType(v.VOUCHERTYPENAME))&&listOf(v).some(e=>e.LEDGERNAME===name));
 const amount=v=>listOf(v).filter(e=>e.LEDGERNAME===name).reduce((sum,e)=>sum+signedEntry(e),0n);
 const opening=cents(d.ledgers[name]?.period_opening)+movements.filter(v=>v.DATE<period.from_date).reduce((sum,v)=>sum+amount(v),0n);
 const vouchers=movements.filter(v=>v.DATE>=period.from_date&&v.DATE<=period.to_date);
 return {opening,closing:opening+vouchers.reduce((sum,v)=>sum+amount(v),0n),vouchers};
}
async function allocationDialog(ledger, amount, existing=[], onDone=()=>{}) {
 const query=new URLSearchParams({company:state.data.active_company,ledger});
 const response=await api('/api/pending_bills?'+query.toString());
 const bills=(response.bills||[]).filter(bill=>bill.reference_kind==='bill');
 const current=existing[0]||{};
 const method=current.BILLTYPE|| (bills.length?'Agst Ref':'On Account');
 const values=new Map(existing.map(row=>[row.BILLID||row.NAME,{amount:Math.abs(Number(row.AMOUNT||0)),name:row.NAME||''}]));
 const rows=bills.map(bill=>`<tr data-allocation-row data-bill-id="${esc(bill.bill_id)}"><td>${esc(bill.name)}</td><td>${esc(shownDate(bill.due_date||bill.date)||'Undated')}</td><td class="amount">${money(cents(bill.pending))}</td><td><input data-allocation-amount inputmode="decimal" value="${esc(values.get(bill.bill_id)?.amount?.toFixed(2)||'')}" aria-label="Allocation for ${esc(bill.name)}"></td></tr>`).join('');
 const body=`<div class="allocation-head"><b>${esc(ledger)}</b><span>Entry amount</span><input id="allocation-amount" inputmode="decimal" value="${esc(amount||'')}" autocomplete="off"></div><div class="field"><label for="allocation-method">Type of reference</label><select id="allocation-method"><option ${method==='New Ref'?'selected':''}>New Ref</option><option ${method==='Agst Ref'?'selected':''}>Agst Ref</option><option ${method==='Advance'?'selected':''}>Advance</option><option ${method==='On Account'?'selected':''}>On Account</option></select></div><div class="allocation-new"><label>Reference name <input id="allocation-name" value="${esc(current.NAME||'')}" autocomplete="off"></label></div><div class="allocation-table-wrap"><table class="allocation-table"><thead><tr><th>Bill</th><th>Due</th><th class="amount">Pending</th><th class="amount">Allocate</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">No pending bills</td></tr>'}</tbody></table></div><div id="allocation-residual" class="inline-hint">Select bills and continue. The residual is explicit.</div><div class="dialog-buttons"><button data-action="allocationContinue">Continue</button><button data-action="close">Cancel</button></div>`;
 showDialog('Bill-wise Details',body,{className:'allocation-dialog',accept:commitAllocationDialog,after:()=>{
  const update=()=>{const total=Number(voucherRules.parseTallyAmount($('#allocation-amount').value));const used=Array.from($('#dialog-body [data-allocation-amount]')).reduce((sum,input)=>sum+(Number(voucherRules.parseTallyAmount(input.value))||0),0);$('#allocation-residual').textContent=`Allocated: ${total-used>=0?(total-used).toFixed(2):'0.00'} residual; Continue validates the exact amount.`;};
  $('#allocation-amount').addEventListener('input',update);$('#dialog-body').addEventListener('input',update);update();
 }});
 state.dialog.allocation={ledger,onDone};
}
function inventoryAllocationRow(allocation={}, unit='') {
 return `<tr class="inventory-allocation-row"><td><select data-inventory-godown>${state.data.godowns.map(name=>`<option ${name===(allocation.godown||'Main Location')?'selected':''}>${esc(name)}</option>`).join('')}</select></td><td><input data-inventory-batch value="${esc(allocation.batch||'')}" autocomplete="off"></td><td><input data-inventory-expiry value="${esc(allocation.expiry||'')}" placeholder="YYYY-MM-DD" autocomplete="off"></td><td><input data-inventory-quantity inputmode="decimal" value="${esc(allocation.quantity||'')}" autocomplete="off"><span>${esc(unit)}</span></td></tr>`;
}
function inventoryAllocationDialog(select) {
 if(state.dialog) return;
 const row=select?.closest('.inventory-entry'), name=select?.value, item=state.data.stock_items[name]||{};
 if(!row||!name||!(item.track_allocations==='Yes'||item.godown_enabled==='Yes'||item.batch_enabled==='Yes'))return;
 if(!row.dataset.lineId){state.draft.lineSequence=(state.draft.lineSequence||0)+1;row.dataset.lineId=`inventory-${state.draft.lineSequence}`;}
 const lineId=row.dataset.lineId;
 const existing=state.draft.inventoryAllocations?.[lineId]||[];
 const quantity=row.querySelector('[name=qty]')?.value||'';
 const body=`<div class="allocation-head"><b>${esc(name)}</b><span>Line quantity</span><input id="inventory-allocation-total" inputmode="decimal" value="${esc(quantity)}"></div><div class="allocation-table-wrap"><table class="allocation-table"><thead><tr><th>Godown</th><th>Batch / Lot</th><th>Expiry</th><th>Quantity</th></tr></thead><tbody id="inventory-allocation-rows">${(existing.length?existing:[{quantity}]).map(value=>inventoryAllocationRow(value,item.base_units||'')).join('')}</tbody></table></div><button type="button" data-action="inventoryAddAllocation">Add allocation</button><div class="dialog-buttons"><button data-action="inventoryContinue">Continue</button><button data-action="close">Cancel</button></div>`;
 showDialog('Item Allocation — Godown / Batch',body,{className:'allocation-dialog',accept:commitInventoryAllocationDialog,after:()=>{
  $('#inventory-add-allocation')?.focus();
 }});
 state.dialog.inventory={row,lineId,item};
}
function addInventoryAllocationRow() {
 const item=state.dialog?.inventory?.item||{};
 $('#inventory-allocation-rows')?.insertAdjacentHTML('beforeend',inventoryAllocationRow({},item.base_units||''));
}
function commitInventoryAllocationDialog() {
 const context=state.dialog.inventory, total=$('#inventory-allocation-total')?.value;
 const rows=Array.from(document.querySelectorAll('#inventory-allocation-rows .inventory-allocation-row')).map(row=>({
  godown:row.querySelector('[data-inventory-godown]').value,
  batch:row.querySelector('[data-inventory-batch]').value,
  expiry:row.querySelector('[data-inventory-expiry]').value,
  quantity:row.querySelector('[data-inventory-quantity]').value,
 })).filter(row=>String(row.quantity).trim());
 const result=voucherRules.normalizeInventoryAllocations(total,rows);
 state.draft.inventoryAllocations=state.draft.inventoryAllocations||{};
 state.draft.inventoryAllocations[context.lineId]=result.allocations;
 context.row.dataset.lineId=context.lineId;context.row.dataset.allocations=JSON.stringify(result.allocations);
 context.row.querySelector('[name=qty]').value=result.quantity;
 const first=result.allocations[0];context.row.querySelector('[name=godown]').value=first.godown;
 closeDialog();note('Item allocation ready');
}
document.addEventListener('click',event=>{
 const add=event.target.closest('[data-action="inventoryAddAllocation"]');
 if(add){event.preventDefault();event.stopImmediatePropagation();return addInventoryAllocationRow();}
 const next=event.target.closest('[data-action="inventoryContinue"]');
 if(next){event.preventDefault();event.stopImmediatePropagation();try{commitInventoryAllocationDialog();}catch(error){errorBox(error.message);}}
},true);
async function commitAllocationDialog() {
 const method=$('#allocation-method').value;
 const amount=$('#allocation-amount').value;
 const rows=method==='Agst Ref'?Array.from(document.querySelectorAll('#dialog-body [data-allocation-row]')).map(row=>({bill_id:row.dataset.billId,name:row.cells[0].textContent.trim(),amount:row.querySelector('[data-allocation-amount]').value})).filter(row=>String(row.amount).trim()):[{name:$('#allocation-name').value,amount:amount}].filter(row=>String(row.name).trim());
 const result=voucherRules.normalizeAllocation(method,amount,rows);
 const allocation={...result,ledger:state.dialog.allocation.ledger};
 const callback=state.dialog.allocation.onDone;closeDialog();state.draft.allocations=allocation;callback(allocation);note(`Bill allocation ready; residual ${result.residual}`);
}
async function maybeOpenAllocation() {
 if(state.dialog||frame().kind!=='voucher'||!state.draft)return false;
 const party=$('#edit-form [name=party]')?.value;
 const ledger=state.data.ledgers[party]||{};
 if(!party||String(ledger.is_billwise||'').toLowerCase()!=='yes')return false;
 const amount=$('#edit-form [name=payment_amount]')?.value||'';
 if(!amount||Number(voucherRules.parseTallyAmount(amount))<=0)return false;
 const entry=listOf(state.draft.original).find(row=>row.LEDGERNAME===party)||{};
 await allocationDialog(party,amount,listOf(entry,'BILLALLOCATIONS.LIST'));
 return true;
}
 function invoiceReferences(v) {const party=listOf(v).find(e=>e.LEDGERNAME===v.PARTYLEDGERNAME)||{},bills=listOf(party,'BILLALLOCATIONS.LIST');return bills.length>1?'<div class="inline-info">Bill-wise allocations are retained and managed when the party amount is accepted.</div>':'';}
 function partyAllocation(entry,formData) {
  const saved=state.draft?.allocations;
 if(saved&&saved.ledger===entry.LEDGERNAME&&Math.abs(Number(saved.amount))===Number(abs(signedEntry(entry)))/100){
  const sign=String(entry.AMOUNT||'').trim().startsWith('-')?'-':'';
  const allocations=saved.allocations.filter(row=>Number(row.amount)>0).map(row=>({NAME:row.name,BILLID:row.bill_id,BILLTYPE:saved.method,AMOUNT:sign+row.amount}));
  if(Number(saved.residual)>0&&saved.method!=='Agst Ref')allocations.push({NAME:'On Account',BILLTYPE:'On Account',AMOUNT:sign+saved.residual});
   if(allocations.length){entry['BILLALLOCATIONS.LIST']=allocations;return entry;}
  }
  if(!formData.has('party_bill')&&!formData.has('party_billtype'))return entry;
  let reference=String(formData.get('party_bill')||'').trim(),type=formData.get('party_billtype')||'';
 const bills=listOf(entry,'BILLALLOCATIONS.LIST'),first=bills[0]||{};
 if(reference&&!type)type='New Ref';
 if(type==='On Account'&&!reference)reference='On Account';
 if(reference===(first.NAME||'')&&type===(first.BILLTYPE||''))return entry;
 if(bills.length>1)throw Error('This party has multiple bill allocations. A single reference cannot replace them.');
 if(!reference&&!type){delete entry['BILLALLOCATIONS.LIST'];return entry;}
 if(!['New Ref','Agst Ref','On Account','Advance'].includes(type))throw Error('Select a reference type');
 if(type!=='On Account'&&!reference)throw Error('Enter a bill reference or select On Account');
  entry['BILLALLOCATIONS.LIST']=[{...first,NAME:reference,BILLTYPE:type,AMOUNT:entry.AMOUNT}];
  return entry;
}

function invoiceTaxComponents(form,taxableAmount) {
 const company=state.data.company_meta||{};
 if(!company.gstin)return [];
 const party=state.data.ledgers[form.querySelector('[name=party]')?.value||'']||{};
 const same=!party.state||!company.state||String(party.state).trim().toLowerCase()===String(company.state).trim().toLowerCase();
 const totals={};
 for(const row of form.querySelectorAll('.inventory-entry')){
  const amount=Number(cents(row.querySelector('[name=itemamount]')?.value||0))/100;
  if(amount<=0)continue;
  for(const component of voucherRules.gstComponents(amount,itemTaxRate(form,row),same)){
   const current=totals[component.ledger]||{amount:0,rates:new Set()};current.amount+=Number(component.amount);current.rates.add(component.rate);totals[component.ledger]=current;
  }
 }
 const itemCents=Array.from(form.querySelectorAll('.inventory-entry')).reduce((sum,row)=>sum+cents(row.querySelector('[name=itemamount]')?.value||0),0n);
 const extraCents=BigInt(taxableAmount||0)-itemCents;
 if(extraCents){
  for(const component of voucherRules.gstComponents(Number(extraCents)/100,invoiceTaxRate(form),same)){
   const current=totals[component.ledger]||{amount:0,rates:new Set()};current.amount+=Number(component.amount);current.rates.add(component.rate);totals[component.ledger]=current;
  }
 }
 return Object.entries(totals).map(([ledger,value])=>({ledger,amount:value.amount.toFixed(2),rate:value.rates.size===1?[...value.rates][0]:'mixed'}));
}

function applyInventoryAllocationMetadata(voucher) {
 const draft=state.draft, form=$('#edit-form');
 if(!draft?.inventoryAllocations||!form)return voucher;
 for(const section of form.querySelectorAll('.inventory-section')){
  const key=section.dataset.key, output=listOf(voucher,key), rows=Array.from(section.querySelectorAll('.inventory-entry'));
  rows.forEach((row,index)=>{
   const allocations=draft.inventoryAllocations[row.dataset.lineId];
   const entry=output[index];
   if(!allocations||!entry)return;
   const unit=state.data.stock_items[entry.STOCKITEMNAME]?.base_units||'';
   const total=Number(voucherRules.parseTallyAmount(String(entry.ACTUALQTY||entry.BILLEDQTY||'').split(' ')[0]||0));
   const lineAmount=Number(cents(entry.AMOUNT||0))/100;
   entry['BATCHALLOCATIONS.LIST']=allocations.map(allocation=>{
    const quantity=Number(allocation.quantity),amount=(lineAmount*quantity/(total||quantity)).toFixed(2);
    const signed=String(entry.AMOUNT||'').trim().startsWith('-')?'-':'';
    return {GODOWNNAME:allocation.godown,BATCHNAME:allocation.batch,EXPIRYDATE:allocation.expiry,
     ACTUALQTY:`${allocation.quantity} ${unit}`.trim(),BILLEDQTY:`${allocation.quantity} ${unit}`.trim(),
     AMOUNT:signed+amount};
   });
  });
 }
 return voucher;
}
const collectVoucherWithInventoryAllocations=collectVoucher;
collectVoucher=function(){return applyInventoryAllocationMetadata(collectVoucherWithInventoryAllocations());};
document.addEventListener('change',event=>{
 if(event.target?.name==='item'&&event.target.closest('.inventory-entry'))inventoryAllocationDialog(event.target);
 });

function compactInventoryLine(e={},originalIndex=-1) {
  const profile=state.draft?.billingProfile||billingProfileFor(state.draft?.base), item=state.data.stock_items[e.STOCKITEMNAME]||{}, batch=listOf(e,'BATCHALLOCATIONS.LIST')[0]||{};
  const valueFor=field=>field.key==='qty'?String(e.ACTUALQTY||e.BILLEDQTY||'').split(' ')[0]:field.key==='alt_qty'?String(e.ALTQTY||''):field.key==='rate'?String(e.RATE||'').split('/')[0]:field.key==='amount'?(e.AMOUNT?decimalMoney(abs(cents(e.AMOUNT))):''):String(e[field.key]||'');
  const cells=profile.fields.map(field=>{if(field.key==='item')return `<td>${ledgerSelect('item','Stock item',e.STOCKITEMNAME,Object.keys(state.data.stock_items))}</td>`;const readonly=field.kind==='calculated'?' readonly':'';const name=field.key==='amount'?'itemamount':field.key;return `<td class="${field.key==='amount'?'amount':field.key==='qty'||field.key==='alt_qty'?'qty':field.key==='rate'?'rate':''}"><input name="${esc(name)}" aria-label="${esc(field.label)}" value="${esc(valueFor(field))}" inputmode="decimal"${readonly}></td>`;}).join('');
  return `<tr class="inventory-entry" data-original="${originalIndex}">${cells}<td hidden><span class="unit"></span><input type="hidden" name="godown" value="${esc(batch.GODOWNNAME||'')}"></td><td style="width:25px"><button type="button" data-action="removeLine" aria-label="Remove item">×</button></td></tr>`;
}
function compactInventoryEditor(v,base) {
  const keys=base==='Stock Journal'?['CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST']:base==='Physical Stock'?['PHYSICALSTOCKENTRIES.LIST']:['ALLINVENTORYENTRIES.LIST'];
  return keys.map(key=>`<div class="inventory-section" data-key="${key}">${keys.length>1?`<div class="form-heading">${key.startsWith('CONSUMPTION')?'Source (Consumption)':'Destination (Production)'}</div>`:''}<table class="inventory-table"><thead><tr>${(state.draft?.billingProfile||billingProfileFor(base)).fields.map(field=>`<th class="${field.key==='amount'?'amount':field.key==='qty'||field.key==='alt_qty'?'qty':field.key==='rate'?'rate':''}">${esc(field.label)}</th>`).join('')}</tr></thead><tbody>${(listOf(v,key).length?listOf(v,key):[{}]).map(compactInventoryLine).join('')}</tbody></table></div>`).join('')+(!nonAccounting.has(base)?`<table id="extra-table"><tbody>${(listOf(v).map((e,i)=>({e,i})).filter(({e})=>e.LEDGERNAME!==v.PARTYLEDGERNAME&&e.LEDGERNAME!==state.draft.accountName&&!['CGST','SGST','IGST'].includes(e.LEDGERNAME)).map(({e,i})=>ledgerLine(e,i)).join('')||ledgerLine())}</tbody></table><div id="tax-preview" class="auto-tax"></div>`:'');
}
function compactLedgerLine(e={},originalIndex=-1) {const sum=e.AMOUNT?signedEntry(e):0n,bill=listOf(e,'BILLALLOCATIONS.LIST')[0]||{};return `<tr class="entry" data-original="${originalIndex}"><td class="side"><select name="side">${['Dr','Cr'].map(s=>`<option ${s===(sum<0n?'Cr':'Dr')?'selected':''}>${s}</option>`).join('')}</select></td><td>${ledgerSelect('ledger','Ledger',e.LEDGERNAME,Object.keys(state.data.ledgers))}</td><td hidden><input type="hidden" name="bill" value="${esc(bill.NAME||'')}"><input type="hidden" name="billtype" value="${esc(bill.BILLTYPE||'On Account')}"></td><td class="amount"><input name="amount" aria-label="Amount" inputmode="decimal" value="${e.AMOUNT?decimalMoney(abs(sum)):''}"></td><td style="width:25px"><button type="button" data-action="removeLine" aria-label="Remove line">×</button></td></tr>`;}
function compactLedgerEditor(v) {const rows=listOf(v);return `<table id="entry-table"><thead><tr><th class="side">Dr/Cr</th><th>Particulars</th><th class="amount">Amount</th></tr></thead><tbody>${(rows.length?rows:[{},{}]).map((e,i)=>compactLedgerLine(e,i)).join('')}</tbody></table>`;}
function inventoryEditor(v,base) {return compactInventoryEditor(v,base);}
function ledgerEditor(v) {return compactLedgerEditor(v);}
const compactCollector=collectVoucher;
collectVoucher=function(){const voucher=compactCollector();if(state.draft?.mode==='invoice'&&document.querySelector('.inventory-entry')){const profile=state.draft.billingProfile||billingProfileFor(state.draft.base),rows=[],client=[];for(const section of document.querySelectorAll('.inventory-section')){const key=section.dataset.key,output=listOf(voucher,key);Array.from(section.querySelectorAll('.inventory-entry')).forEach((row,index)=>{if(!row.querySelector('[name=item]')?.value)return;updateBillingRow(row);const values={};for(const field of profile.fields){const value=billingFieldValue(row,field);if(field.key!=='item'&&field.key!=='amount')values[field.key]=value;}const item=output[index];if(item&&values.alt_qty!==undefined&&values.alt_qty!=='')item.ALTQTY=values.alt_qty;rows.push({item:row.querySelector('[name=item]').value,...values,amount:row.querySelector('[name=itemamount]').value});client.push(row.querySelector('[name=itemamount]').value);});}if(rows.length){voucher.BILLING_PROFILE=state.draft.base;voucher.BILLING_ROWS=rows;voucher.BILLING_CLIENT_AMOUNTS=client;}}return voucher;};
document.addEventListener('input',event=>{if(event.target.closest?.('.inventory-entry')&&state.draft?.mode==='invoice')updateBillingRow(event.target.closest('.inventory-entry'));});
function ledgerLine(e={},originalIndex=-1) {return compactLedgerLine(e,originalIndex);}
function inventoryLine(e={},originalIndex=-1) {return compactInventoryLine(e,originalIndex);}
 function paymentEditor(v,base='Payment') {const rows=listOf(v),banks=cashBankNames(),parties=paymentPartyNames(),bankEntry=rows.find(e=>banks.includes(e.LEDGERNAME))||{},partyEntry=rows.find(e=>e.LEDGERNAME===v.PARTYLEDGERNAME)||rows.find(e=>parties.includes(e.LEDGERNAME))||{},amount=partyEntry.AMOUNT?decimalMoney(abs(signedEntry(partyEntry))):'',direction=base==='Receipt'?'Debit bank / cash and credit the party':'Debit the party and credit bank / cash';return `<table id="payment-table" class="payment-table"><tbody><tr><td class="payment-label">Bank / Cash</td><td>${ledgerSelect('payment_bank','Bank / Cash',bankEntry.LEDGERNAME,banks)}</td><td class="payment-help">Select the account affected by the ${base.toLowerCase()}</td></tr><tr><td class="payment-label">Party / Ledger</td><td>${ledgerSelect('party','Party / Ledger',v.PARTYLEDGERNAME,parties)}</td><td><span id="payment-balance">${paymentBalanceText(v.PARTYLEDGERNAME)}</span></td></tr><tr><td class="payment-label">Amount</td><td><input name="payment_amount" class="amount" inputmode="decimal" value="${esc(amount)}"></td><td>${direction}</td></tr></tbody></table>`;}
if(typeof window!=='undefined'&&window.IndependentPrintView){const nativePrint=window.print.bind(window);window.print=function(){let model;if(frame().kind==='voucher'){let voucher=frame().existing||{};try{voucher=collectVoucher();}catch(error){note(error.message,true);}model=window.IndependentPrintView.buildVoucherPrintModel(voucher,state.data.company_meta,state.draft?.billingProfile,getPrintSettings());}else model=window.IndependentPrintView.buildReportPrintModel($('.report')||$('#screen'));const root=window.IndependentPrintView.renderPrintDocument(model);if(!root)return nativePrint();document.body.appendChild(root);document.body.classList.add('has-print-root');const cleanup=()=>{root.remove();document.body.classList.remove('has-print-root');};window.addEventListener('afterprint',cleanup,{once:true});nativePrint();};}


function renderItemRatesManager() {
  $('#title').textContent = 'Item Rates Manager';
  const items = Object.entries(state.data.stock_items || {});
  $('#screen').innerHTML = `
    <div class="report">
      <div class="report-caption">
        <strong>Item Rates Manager</strong>
        <div class="report-meta">${esc(state.data.active_company)}<br>Standard Purchase and Selling Rates</div>
      </div>
      <div class="report-scroll">
        <table class="report-table rates-table" id="item-rates-table">
          <thead>
            <tr>
              <th>Stock Item</th>
              <th>Unit</th>
              <th class="amount" style="text-align:right">Std Purchase Rate</th>
              <th class="amount" style="text-align:right">Std Selling Rate</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(([name, item]) => `
              <tr data-item-name="${esc(name)}">
                <td><strong>${esc(name)}</strong></td>
                <td>${esc(item.base_units || '')}</td>
                <td class="amount">
                  <input style="text-align:right" name="purchase_rate" value="${esc(item.standard_purchase_rate || '')}" placeholder="0.00">
                </td>
                <td class="amount">
                  <input style="text-align:right" name="selling_rate" value="${esc(item.standard_selling_rate || '')}" placeholder="0.00">
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${!items.length ? '<div class="empty">No stock items found</div>' : ''}
      </div>
      <div class="form-actions" style="margin-top:12px;padding:8px 0;display:flex;gap:12px">
        <button type="button" data-action="saveItemRates" class="primary-btn">Save Rates (Ctrl+A)</button>
        <button type="button" data-action="back">Back (Esc)</button>
      </div>
    </div>
  `;
  setKeys([['F3','Company','company'],['Ctrl+A','Save','saveItemRates'],['Esc','Back','back']]);
}

async function saveItemRates() {
  const table = document.getElementById('item-rates-table');
  if(!table) return;
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const payload = rows.map(r => ({
    name: r.dataset.itemName,
    standard_purchase_rate: r.querySelector('[name=purchase_rate]')?.value || '',
    standard_selling_rate: r.querySelector('[name=selling_rate]')?.value || ''
  }));
  try {
    const res = await api('/api/bulk_update_rates', {
      company: state.data.active_company,
      items: payload
    });
    await refresh();
    note(`Updated rates for ${res.updated || 0} item(s)`);
    render();
  } catch(err) {
    errorBox(err.message);
  }
}


function renderUnifiedTabs(activeTab) {
  return `
    <div class="uset-tabs">
      <button type="button" class="uset-tab-btn ${activeTab==='reports'?'active':''}" data-action="switchUsetTab" data-args="reports">
        <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Reports & Display
      </button>
      <button type="button" class="uset-tab-btn ${activeTab==='billing'?'active':''}" data-action="switchUsetTab" data-args="billing">
        <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Billing & Formulas
      </button>
      <button type="button" class="uset-tab-btn ${activeTab==='masters'?'active':''}" data-action="switchUsetTab" data-args="masters">
        <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Masters & Notes
      </button>
      <button type="button" class="uset-tab-btn ${activeTab==='print'?'active':''}" data-action="switchUsetTab" data-args="print">
        <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print & Layout
      </button>
    </div>
  `;
}

async function showUnifiedSettingsModal(activeTab) {
  if(!requireCompany()) return;
  const f = frame(), k = f.kind;
  if(!activeTab) {
    if(k === 'report' || k === 'comparison' || k === 'ageing') activeTab = 'reports';
    else if(k === 'master' || k === 'masters') activeTab = 'masters';
    else activeTab = 'billing';
  }

  if(activeTab === 'billing') {
    const result = await api('/api/billing_profiles?company=' + encodeURIComponent(state.data.active_company));
    const profiles = clone(result.profiles), type = Object.keys(profiles)[0] || 'Sales';
    const body = `
      <div class="uset-modal">
        ${renderUnifiedTabs(activeTab)}
        <div class="uset-tab-panel active">
          <div class="uset-section-title">Billing & Voucher Formula Rules</div>
          <div class="field"><label for="billing-type">Voucher type</label><select id="billing-type">${Object.keys(profiles).map(name=>`<option ${name===type?'selected':''}>${esc(name)}</option>`).join('')}</select></div>
          <div class="billing-field-head"><span>Key</span><span>Label</span><span>Kind</span><span>Required</span><span></span></div>
          <div id="billing-fields"></div>
          <button type="button" data-action="billingAddField">Add numeric field</button>
          <div class="field"><label for="billing-formula">Amount formula</label><input id="billing-formula" autocomplete="off"></div>
          <div class="field"><label for="billing-quantity-basis">Quantity basis</label><select id="billing-quantity-basis"></select></div>
          <div class="inline-hint">Allowed formula fields are numeric row keys. Operators: +, -, *, /, %, and parentheses. Recalculated on save.</div>
          <div class="dialog-buttons">
            <button type="button" data-action="saveBillingProfiles">Save settings</button>
            <button type="button" data-action="close">Quit</button>
          </div>
        </div>
      </div>
    `;
    showDialog('Configuration', body, {
      className: 'data-dialog',
      after: () => {
        state.dialog.billingProfiles = profiles;
        state.dialog.billingType = type;
        $('#billing-type')?.addEventListener('change', event => {
          collectBillingProfileSettings();
          state.dialog.billingType = event.target.value;
          renderBillingSettings();
        });
        renderBillingSettings();
      }
    });
    return;
  }

  if(activeTab === 'reports') {
    const isDetailed = Boolean(f.detailed);
    const showNarration = Boolean(f.showNarration);
    const body = `
      <div class="uset-modal">
        ${renderUnifiedTabs(activeTab)}
        <div class="uset-tab-panel active">
          <div class="uset-section-title">Report & Display Settings</div>
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="cfg-detailed" ${isDetailed ? 'checked' : ''}>
            <span>Detailed format (Alt+F5 / Alt+F1)</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="cfg-narration" ${showNarration ? 'checked' : ''}>
            <span>Show Narration</span>
          </label>
          <div class="field" style="margin-top:6px">
            <label for="cfg-sorting">Sorting Method</label>
            <select id="cfg-sorting">
              <option ${f.sorting==='default'?'selected':''}>Default</option>
              <option ${f.sorting==='date'?'selected':''}>Date</option>
              <option ${f.sorting==='alphabetical'?'selected':''}>Alphabetical</option>
              <option ${f.sorting==='amount'?'selected':''}>Amount</option>
            </select>
          </div>
          <div class="dialog-buttons">
            <button type="button" data-action="confirm">Accept</button>
            <button type="button" data-action="close">Quit</button>
          </div>
        </div>
      </div>
    `;
    showDialog('Configuration', body, {
      className: 'lookup-dialog',
      accept: async () => {
        f.detailed = document.getElementById('cfg-detailed')?.checked || false;
        f.showNarration = document.getElementById('cfg-narration')?.checked || false;
        f.sorting = document.getElementById('cfg-sorting')?.value || 'default';
        closeDialog();
        render();
        note('Report display settings updated');
      }
    });
    return;
  }

  if(activeTab === 'masters') {
    const body = `
      <div class="uset-modal">
        ${renderUnifiedTabs(activeTab)}
        <div class="uset-tab-panel active">
          <div class="uset-section-title">Master & Ledger Settings</div>
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="cfg-aliases" ${f.showAliases ? 'checked' : ''}>
            <span>Provide Aliases along with Name</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="cfg-descriptions" ${f.showNotes ? 'checked' : ''}>
            <span>Provide Notes / Description</span>
          </label>
          <div class="dialog-buttons">
            <button type="button" data-action="confirm">Accept</button>
            <button type="button" data-action="close">Quit</button>
          </div>
        </div>
      </div>
    `;
    showDialog('Configuration', body, {
      className: 'lookup-dialog',
      accept: async () => {
        f.showAliases = document.getElementById('cfg-aliases')?.checked || false;
        f.showNotes = document.getElementById('cfg-descriptions')?.checked || false;
        closeDialog();
        render();
        note('Master settings updated');
      }
    });
    return;
  }

  if(activeTab === 'print') {
    const s = getPrintSettings();
    const body = `
      <div class="uset-modal">
        ${renderUnifiedTabs(activeTab)}
        <div class="uset-tab-panel active">
          <div class="uset-section-title">Invoice & Document Print Layout</div>
          <div class="print-config-grid">
            <div class="print-config-item">
              <label for="pcfg-border">Border Mode</label>
              <select id="pcfg-border" name="borderMode">
                <option value="boxed" ${s.borderMode === 'boxed' ? 'selected' : ''}>Boxed Grid</option>
                <option value="borderless" ${s.borderMode === 'borderless' ? 'selected' : ''}>Borderless</option>
              </select>
            </div>
            <div class="print-config-item">
              <label for="pcfg-title">Document Title</label>
              <input type="text" id="pcfg-title" name="documentTitle" value="${esc(s.documentTitle || 'Tax Invoice')}">
            </div>
            <div class="print-config-item">
              <label for="pcfg-comp-addr">Show Company Address</label>
              <input type="checkbox" id="pcfg-comp-addr" name="showCompanyAddress" ${s.showCompanyAddress ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-gstin">Show GSTIN</label>
              <input type="checkbox" id="pcfg-gstin" name="showGstin" ${s.showGstin ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-buyer-addr">Show Buyer Address</label>
              <input type="checkbox" id="pcfg-buyer-addr" name="showBuyerAddress" ${s.showBuyerAddress ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-hsn">Show HSN / SAC</label>
              <input type="checkbox" id="pcfg-hsn" name="showHsn" ${s.showHsn ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-gst-brk">Show GST Tax Breakup</label>
              <input type="checkbox" id="pcfg-gst-brk" name="showGstBreakup" ${s.showGstBreakup ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-bank">Show Bank Details</label>
              <input type="checkbox" id="pcfg-bank" name="showBankDetails" ${s.showBankDetails ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-words">Show Amount in Words</label>
              <input type="checkbox" id="pcfg-words" name="showAmountInWords" ${s.showAmountInWords ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-terms">Show Terms & Conditions</label>
              <input type="checkbox" id="pcfg-terms" name="showTerms" ${s.showTerms ? 'checked' : ''}>
            </div>
            <div class="print-config-item">
              <label for="pcfg-sign">Show Authorised Signatory</label>
              <input type="checkbox" id="pcfg-sign" name="showSignatory" ${s.showSignatory ? 'checked' : ''}>
            </div>
          </div>
          <div class="dialog-buttons" style="margin-top:14px;">
            <button type="button" class="primary-btn" data-action="savePrintConfig">Accept</button>
            <button type="button" data-action="close">Cancel</button>
          </div>
        </div>
      </div>
    `;
    showDialog('Configuration', body, {
      className: 'data-dialog',
      accept: savePrintConfig
    });
    return;
  }
}
function showReportSettings(f) { return showUnifiedSettingsModal('reports'); }
function showMasterSettings(f) { return showUnifiedSettingsModal('masters'); }
function handleContextualConfigure() { return showUnifiedSettingsModal(); }


function showBulkTemplatesDialog() {
  if(!requireCompany()) return;
  const body = `
    <div class="bulk-templates-dialog" style="display:flex;flex-direction:column;gap:16px;padding:6px 0">
      <div style="background:rgba(27,67,50,0.1);padding:10px;border-radius:8px">
        <strong style="color:var(--accent);display:block;margin-bottom:6px">1. Download Sample Templates</strong>
        <p style="font-size:12px;margin:0 0 10px 0;opacity:0.85">Download formatted sample files with proper column headers for Ledgers and Stock Items.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/api/sample_template?type=ledgers&format=xlsx" download="sample_bulk_ledgers.xlsx" class="btn" style="text-decoration:none;padding:5px 10px;background:#fff;border:1px solid var(--line);border-radius:4px;font-size:12px;color:#1d4b2b;font-weight:bold">Ledgers (.xlsx)</a>
          <a href="/api/sample_template?type=ledgers&format=csv" download="sample_bulk_ledgers.csv" class="btn" style="text-decoration:none;padding:5px 10px;background:#fff;border:1px solid var(--line);border-radius:4px;font-size:12px;color:#1d4b2b">Ledgers (.csv)</a>
          <a href="/api/sample_template?type=items&format=xlsx" download="sample_bulk_items.xlsx" class="btn" style="text-decoration:none;padding:5px 10px;background:#fff;border:1px solid var(--line);border-radius:4px;font-size:12px;color:#1d4b2b;font-weight:bold">Stock Items (.xlsx)</a>
          <a href="/api/sample_template?type=items&format=csv" download="sample_bulk_items.csv" class="btn" style="text-decoration:none;padding:5px 10px;background:#fff;border:1px solid var(--line);border-radius:4px;font-size:12px;color:#1d4b2b">Stock Items (.csv)</a>
        </div>
      </div>
      <div style="background:rgba(27,67,50,0.1);padding:10px;border-radius:8px">
        <strong style="color:var(--accent);display:block;margin-bottom:6px">2. Upload Completed File</strong>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
          <label style="font-size:12px">Import Type:</label>
          <select id="bulk-import-type">
            <option value="ledgers">Ledgers</option>
            <option value="items">Stock Items</option>
          </select>
        </div>
        <input type="file" id="bulk-import-file" accept=".csv,.xlsx" style="font-size:12px;width:100%">
      </div>
      <div id="bulk-import-status" style="font-size:12px;min-height:18px"></div>
      <div class="dialog-buttons">
        <button type="button" data-action="doBulkImport" id="btn-do-bulk-import">Upload & Import</button>
        <button type="button" data-action="close">Close</button>
      </div>
    </div>
  `;
  showDialog('Bulk Master Templates & Import', body, {
    className: 'lookup-dialog',
    after: () => {
      const btn = document.getElementById('btn-do-bulk-import');
      btn.onclick = async () => {
        const fileInput = document.getElementById('bulk-import-file');
        const file = fileInput?.files?.[0];
        if(!file) return errorBox('Select a CSV or XLSX file to import');
        const type = document.getElementById('bulk-import-type')?.value || 'ledgers';
        const isXlsx = file.name.endsWith('.xlsx');
        const statusEl = document.getElementById('bulk-import-status');
        statusEl.textContent = 'Importing...';
        try {
          let content;
          if(isXlsx) {
            const buf = await file.arrayBuffer();
            content = Array.from(new Uint8Array(buf)).map(b => String.fromCharCode(b)).join('');
          } else {
            content = await file.text();
          }
          const res = await api('/api/bulk_import', {
            company: state.data.active_company,
            type,
            format: isXlsx ? 'xlsx' : 'csv',
            content
          });
          await refresh();
          closeDialog();
          note(`Bulk import complete: ${res.created} created, ${res.updated} updated`);
          render();
        } catch(err) {
          statusEl.textContent = '';
          errorBox('Bulk import failed: ' + err.message);
        }
      };
    }
  });
}


function getPrintSettings() {
  if(!state.printSettings) {
    try {
      state.printSettings = JSON.parse(localStorage.getItem('books_print_settings') || 'null');
    } catch(e) {}
  }
  if(!state.printSettings) {
    state.printSettings = Object.assign({}, window.IndependentPrintView?.defaultPrintSettings || {
      borderMode: 'boxed',
      showCompanyAddress: true,
      showGstin: true,
      showBuyerAddress: true,
      showHsn: true,
      showGstBreakup: true,
      showBankDetails: true,
      showAmountInWords: true,
      showTerms: true,
      showSignatory: true,
      documentTitle: 'Tax Invoice'
    });
  }
  return state.printSettings;
}

function showPrintOverlay() {
  let voucher = frame().existing || {};
  try { voucher = collectVoucher(); } catch(e) {}
  const vtype = voucher.VOUCHERTYPENAME || frame().vtype || state.draft?.base || 'Voucher';
  const vnum = voucher.VOUCHERNUMBER || '';
  const vdate = voucher.DATE ? shownDate(voucher.DATE) : (state.workingDate || shownDate(state.data.current_date_iso));
  const party = voucher.PARTYLEDGERNAME || $('#edit-form [name=party]')?.value || '';

  const body = `
    <div class="print-dialog-content">
      <div class="print-voucher-info">
        <div><strong>Voucher:</strong> ${esc(vtype)} ${esc(vnum)}</div>
        <div><strong>Party:</strong> ${esc(party || 'Cash/General')}</div>
        <div><strong>Date:</strong> ${esc(vdate)}</div>
      </div>
      <div class="print-actions-grid">
        <button type="button" class="print-btn primary-btn" data-action="doPrintDirect">
          <strong>P</strong>rint (Enter / P)
        </button>
        <button type="button" class="print-btn" data-action="doPrintPreview">
          Preve<strong>i</strong>w (I)
        </button>
        <button type="button" class="print-btn" data-action="doPrintConfigure">
          <strong>C</strong>onfigure (C)
        </button>
      </div>
      <div class="dialog-buttons" style="margin-top:12px;">
        <button type="button" data-action="close">Close (Esc)</button>
      </div>
    </div>
  `;
  showDialog('Print', body);
  state.dialog.isPrintDialog = true;
}

function openPrintPreview() {
  closeDialog();
  let voucher = frame().existing || {};
  try { voucher = collectVoucher(); } catch(e) {}
  const settings = getPrintSettings();
  const model = window.IndependentPrintView.buildVoucherPrintModel(voucher, state.data.company_meta, state.draft?.billingProfile, settings);
  const existing = document.getElementById('invoice-preview-overlay');
  if(existing) existing.remove();

  const preview = document.createElement('div');
  preview.id = 'invoice-preview-overlay';
  preview.className = 'invoice-preview-container';
  preview.innerHTML = `
    <div class="invoice-preview-toolbar">
      <span>Invoice Print Preview</span>
      <div class="invoice-preview-toolbar-actions">
        <button type="button" class="primary-btn" data-action="doPrintFromPreview">Print (P)</button>
        <button type="button" data-action="doPrintConfigureFromPreview">Configure (C)</button>
        <button type="button" data-action="closePrintPreview">Close (Esc)</button>
      </div>
    </div>
    <div class="invoice-preview-body">
      ${window.IndependentPrintView.renderVoucherPrint(model)}
    </div>
  `;
  document.body.appendChild(preview);
}

function closePrintPreview() {
  const el = document.getElementById('invoice-preview-overlay');
  if(el) el.remove();
}

function openPrintConfigure() {
  closeDialog();
  const s = getPrintSettings();
  const body = `
    <div class="print-config-form">
      <div class="print-config-grid">
        <div class="print-config-item">
          <label for="pcfg-border">Border Mode</label>
          <select id="pcfg-border" name="borderMode">
            <option value="boxed" ${s.borderMode === 'boxed' ? 'selected' : ''}>Boxed Grid</option>
            <option value="borderless" ${s.borderMode === 'borderless' ? 'selected' : ''}>Borderless</option>
          </select>
        </div>
        <div class="print-config-item">
          <label for="pcfg-title">Document Title</label>
          <input type="text" id="pcfg-title" name="documentTitle" value="${esc(s.documentTitle || 'Tax Invoice')}">
        </div>
        <div class="print-config-item">
          <label for="pcfg-comp-addr">Show Company Address</label>
          <input type="checkbox" id="pcfg-comp-addr" name="showCompanyAddress" ${s.showCompanyAddress ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-gstin">Show GSTIN</label>
          <input type="checkbox" id="pcfg-gstin" name="showGstin" ${s.showGstin ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-buyer-addr">Show Buyer Address</label>
          <input type="checkbox" id="pcfg-buyer-addr" name="showBuyerAddress" ${s.showBuyerAddress ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-hsn">Show HSN / SAC</label>
          <input type="checkbox" id="pcfg-hsn" name="showHsn" ${s.showHsn ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-gst-brk">Show GST Tax Breakup</label>
          <input type="checkbox" id="pcfg-gst-brk" name="showGstBreakup" ${s.showGstBreakup ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-bank">Show Bank Details</label>
          <input type="checkbox" id="pcfg-bank" name="showBankDetails" ${s.showBankDetails ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-words">Show Amount in Words</label>
          <input type="checkbox" id="pcfg-words" name="showAmountInWords" ${s.showAmountInWords ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-terms">Show Terms & Conditions</label>
          <input type="checkbox" id="pcfg-terms" name="showTerms" ${s.showTerms ? 'checked' : ''}>
        </div>
        <div class="print-config-item">
          <label for="pcfg-sign">Show Authorised Signatory</label>
          <input type="checkbox" id="pcfg-sign" name="showSignatory" ${s.showSignatory ? 'checked' : ''}>
        </div>
      </div>
      <div class="dialog-buttons" style="margin-top:14px;">
        <button type="button" class="primary-btn" data-action="savePrintConfig">Accept (Ctrl+A)</button>
        <button type="button" data-action="close">Cancel</button>
      </div>
    </div>
  `;
  showDialog('Print Configuration', body);
  state.dialog.accept = savePrintConfig;
}

function savePrintConfig() {
  const form = document.getElementById('dialog-body');
  if(!form) return;
  const borderMode = form.querySelector('[name="borderMode"]')?.value || 'boxed';
  const documentTitle = form.querySelector('[name="documentTitle"]')?.value || 'Tax Invoice';
  const showCompanyAddress = Boolean(form.querySelector('[name="showCompanyAddress"]')?.checked);
  const showGstin = Boolean(form.querySelector('[name="showGstin"]')?.checked);
  const showBuyerAddress = Boolean(form.querySelector('[name="showBuyerAddress"]')?.checked);
  const showHsn = Boolean(form.querySelector('[name="showHsn"]')?.checked);
  const showGstBreakup = Boolean(form.querySelector('[name="showGstBreakup"]')?.checked);
  const showBankDetails = Boolean(form.querySelector('[name="showBankDetails"]')?.checked);
  const showAmountInWords = Boolean(form.querySelector('[name="showAmountInWords"]')?.checked);
  const showTerms = Boolean(form.querySelector('[name="showTerms"]')?.checked);
  const showSignatory = Boolean(form.querySelector('[name="showSignatory"]')?.checked);

  state.printSettings = {
    borderMode,
    documentTitle,
    showCompanyAddress,
    showGstin,
    showBuyerAddress,
    showHsn,
    showGstBreakup,
    showBankDetails,
    showAmountInWords,
    showTerms,
    showSignatory
  };
  try {
    localStorage.setItem('books_print_settings', JSON.stringify(state.printSettings));
  } catch(e) {}
  closeDialog();
  note('Print layout settings saved');
}
