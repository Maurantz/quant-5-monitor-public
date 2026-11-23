/* Monitor Apex: snapshot di simulazione, esposizione effettiva e confronto comune. */
(function (global) {
  'use strict';

  const mainId = 'apex_strict_reentry';
  const benchmarkId = 'btc_hold';
  const models = [
    {id:mainId, name:'Apex · soli rientri Strict', short:'Apex · rientri Strict', color:'#48d5b2'},
    {id:benchmarkId, name:'Bitcoin mantenuto', short:'Bitcoin mantenuto', color:'#e7b160'},
    {id:'apex_estimated_halving', name:'Apex originale', short:'Apex originale', color:'#67c4f5'},
    {id:'strict', name:'Strict Macro Cycle', short:'Strict Macro Cycle', color:'#b8a4f8'},
    {id:'core_or_m28_m84', name:'H2 puro settimanale', short:'H2 puro settimanale', color:'#f5a678'},
  ];
  const decisionStatuses = {
    waiting_data:'Decisione in attesa dati', waiting_monday:'In attesa di lunedì', no_trade:'Nessuna operazione prevista',
    executed:'Decisione eseguita in simulazione', missed_week:'Decisione settimanale mancata',
  };
  const phases = {expansion:'Fase di espansione', defence:'Fase di difesa', accumulation:'Fase di accumulo', pre_halving:'Pre-halving'};
  const shortSignals = {above_sma200:'SMA200',mom28_positive:'MOM28',mom84_positive:'MOM84'};
  const longSignals = {mom270_positive:'MOM270',mom300_positive:'MOM300',mom365_positive:'MOM365'};
  const checkFields = [...Object.keys(shortSignals),'weak_week_seen'];
  const decisiveFields = [...checkFields,...Object.keys(longSignals),'h2_positive','sma1400_within_limit'];
  const outcomes = {
    buy:{label:'↗ Compra BTC',target:100,tone:'buy',reason:'Perché compra'},
    sell:{label:'↘ Vendi BTC',target:0,tone:'sell',reason:'Perché vende'},
    hold_btc:{label:'= Mantieni BTC',target:100,tone:'neutral',reason:'Perché mantiene'},
    hold_eur:{label:'= Mantieni EUR',target:0,tone:'neutral',reason:'Perché mantiene'},
  };
  const sources = {
    quote:{label:'Quotazione BTC/EUR',provider:'Crypto.com Exchange',verified:'Verificata'},
    close:{label:'Chiusura BTC giornaliera',provider:'Coin Metrics',verified:'Verificata',reference:'Chiusura UTC'},
    fx:{label:'Cambio USD/EUR',provider:'BCE',verified:'Disponibile',reference:'Fixing'},
    blocks:{label:'Blocchi Bitcoin',provider:'Coin Metrics',verified:'Verificati',reference:'Riferimento UTC'},
  };
  const sourceStatuses = ['verified','waiting','not_required','not_checked'];
  const sourceFields = ['status','expected_at','received_at','reference_date'];
  const sourceDateFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
  const expectedFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  const receivedFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const moneyTolerance = .011;
  const percentTolerance = .011;

  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Campo Apex non valido: ${name}.`);
    return value;
  }

  function number(value, name, minimum = -Infinity, maximum = Infinity) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Valore Apex non valido: ${name}.`);
    return value;
  }

  function calendar(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Data Apex non valida: ${name}.`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value) throw new Error(`Data Apex non valida: ${name}.`);
    return value;
  }

  function instant(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Ora UTC Apex non valida: ${name}.`);
    calendar(value.slice(0,10), name);
    return new Date(value).toISOString();
  }

  function normalizeDecision(raw, startAt, generatedAt) {
    object(raw, 'decisione');
    if (!Object.hasOwn(decisionStatuses, raw.status) || (raw.phase !== null && !Object.hasOwn(phases, raw.phase))) throw new Error('Stato o fase Apex non valida.');
    if (typeof raw.reason !== 'string' || !raw.reason.length || raw.reason.length > 180 || /[\x00-\x1f\x7f]/.test(raw.reason)) throw new Error('Motivo della decisione Apex non valido.');
    const {status,phase,reason} = raw;
    const reference_date = raw.reference_date === null ? null : calendar(raw.reference_date, 'chiusura di riferimento');
    const decided_at = raw.decided_at === null ? null : instant(raw.decided_at, 'decisione');
    const executed_at = raw.executed_at === null ? null : instant(raw.executed_at, 'esecuzione');
    if ((reference_date && reference_date >= generatedAt.slice(0,10))
        || (decided_at && (!reference_date || reference_date >= decided_at.slice(0,10) || decided_at < startAt || decided_at > generatedAt))
        || (executed_at && (!decided_at || executed_at < decided_at || executed_at > generatedAt))) throw new Error('Cronologia decisionale Apex incoerente.');
    if ((status === 'executed' && !executed_at) || (status !== 'executed' && executed_at) || (status === 'no_trade' && !decided_at)) throw new Error('Decisione ed esecuzione Apex incoerenti.');
    const checks = {};
    object(raw.checks,'condizioni di rientro');
    for (const check of checkFields) {
      const value = raw.checks[check];
      if (value !== null && typeof value !== 'boolean') throw new Error(`Condizione Apex non valida: ${check}.`);
      checks[check] = value;
    }
    const decision = {reference_date,status,phase,decided_at,executed_at,reason,checks};
    if (raw.indicators !== undefined) decision.indicators = normalizeIndicators(raw.indicators, decision);
    return decision;
  }

  function normalizeIndicators(raw, decision) {
    const long = Object.keys(longSignals);
    exactFields(raw,[...long,'h2_positive','sma1400_ratio_pct','sma1400_within_limit','decisive','action'],'indicatori');
    const {phase,decided_at,checks,status} = decision;
    const {h2_positive,sma1400_ratio_pct,sma1400_within_limit,decisive,action} = raw;
    const inDefence = phase === 'defence';
    if (!phase || !decided_at || !['waiting_data','no_trade','executed'].includes(status)
        || Object.keys(shortSignals).some(key=>typeof checks[key]!=='boolean')
        || (inDefence ? typeof checks.weak_week_seen!=='boolean' : checks.weak_week_seen!==null)) throw new Error('Condizioni della decisione Apex incomplete.');
    if ([...long,'h2_positive'].some(key=>typeof raw[key]!=='boolean')
        || h2_positive!==(long.filter(key=>raw[key]).length>=2 || checks.mom28_positive&&checks.mom84_positive)) throw new Error('Segnale H2 Apex incoerente.');
    if (inDefence ? sma1400_ratio_pct!==null || sma1400_within_limit!==null
      : typeof sma1400_within_limit!=='boolean' || !Number.isFinite(sma1400_ratio_pct) || sma1400_ratio_pct<=0 || sma1400_ratio_pct>140000
        || (Math.abs(sma1400_ratio_pct-105)>1e-9 && sma1400_within_limit!==(sma1400_ratio_pct<=105))) throw new Error('Soglia SMA1400 Apex incoerente.');
    if (!Array.isArray(decisive) || decisive.some(key=>!decisiveFields.includes(key)) || new Set(decisive).size!==decisive.length
        || !Object.hasOwn(outcomes,action) || (status==='executed' && !['buy','sell'].includes(action))) throw new Error('Azione o segnali decisivi Apex non validi.');
    return {...raw,decisive:[...decisive]};
  }

  function normalizeAccounts(raw, initial) {
    object(raw,'portafogli');
    const accounts = {};
    for (const {id} of models) {
      const account = object(raw[id], id);
      const cash_eur = number(account.cash_eur,'liquidità',0);
      const value_eur = number(account.value_eur,'patrimonio',0);
      const pnl_eur = number(account.pnl_eur,'profitto o perdita');
      const return_pct = number(account.return_pct,'rendimento',-100);
      const max_drawdown_pct = number(account.max_drawdown_pct,'drawdown massimo',-100,0);
      const target_btc_pct = account.target_btc_pct;
      if (![0,100,null].includes(target_btc_pct) || cash_eur > value_eur
          || Math.abs(value_eur-initial-pnl_eur)>moneyTolerance
          || Math.abs(pnl_eur/initial*100-return_pct)>percentTolerance) throw new Error(`Dati del portafoglio Apex incoerenti: ${id}.`);
      accounts[id] = {cash_eur,value_eur,pnl_eur,return_pct,max_drawdown_pct,target_btc_pct};
    }
    return accounts;
  }

  function normalizeHistory(raw, accounts, start, market, initial) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 1200) throw new Error('Storico Apex non valido.');
    let last = '';
    const peaks = Object.fromEntries(models.map(({id})=>[id,initial]));
    const history = raw.map(row => {
      object(row,'rilevazione');
      const at = instant(row.at,'rilevazione');
      if (at <= last || at < start || at > market) throw new Error('Rilevazioni Apex fuori sequenza.');
      last = at;
      object(row.values_eur,'valori storici');
      const values_eur = {};
      for (const {id} of models) {
        const value = number(row.values_eur[id],'patrimonio storico',0);
        peaks[id] = Math.max(peaks[id],value);
        if (accounts[id].max_drawdown_pct > (value/peaks[id]-1)*100 + percentTolerance) throw new Error(`Drawdown Apex incoerente: ${id}.`);
        values_eur[id] = value;
      }
      return {at,values_eur};
    });
    const tail = history.at(-1);
    if (tail.at !== market) throw new Error('Ultima quotazione Apex fuori sequenza.');
    for (const {id} of models) {
      if (Math.abs(tail.values_eur[id]-accounts[id].value_eur)>moneyTolerance) throw new Error(`Patrimonio Apex incoerente con l’ultima rilevazione: ${id}.`);
    }
    return history;
  }

  function normalizeMonitoring(raw) {
    object(raw, 'monitoraggio');
    if (!['ok','failed','updating','stale','bootstrap'].includes(raw.status)) throw new Error('Stato del monitoraggio Apex non valido.');
    const monitoring = {status:raw.status,message:typeof raw.message === 'string'?raw.message.slice(0,300):''};
    if (raw.last_attempt_at != null) monitoring.last_attempt_at = instant(raw.last_attempt_at,'ultimo tentativo');
    for (const name of ['source_url','url']) {
      if (typeof raw[name] === 'string' && /^https:\/\/github\.com\/Maurantz\/quant-5-crypto-bot\/actions\/runs\/\d+$/.test(raw[name])) monitoring[name] = raw[name];
    }
    if (raw.source_run_id != null && /^\d+$/.test(String(raw.source_run_id))) monitoring.source_run_id = String(raw.source_run_id);
    return monitoring;
  }

  function exactFields(raw, keys, name) {
    object(raw, name);
    if (Object.keys(raw).length !== keys.length || !keys.every(key=>Object.hasOwn(raw,key))) throw new Error(`Campi Apex non validi: ${name}.`);
  }

  function normalizeSources(raw, generatedAt) {
    const keys = Object.keys(sources);
    exactFields(raw, keys, 'fonti');
    return Object.fromEntries(keys.map(key=>{
      const row = raw[key];
      exactFields(row, sourceFields, key);
      const {status} = row;
      if (!sourceStatuses.includes(status)) throw new Error(`Stato della fonte Apex non valido: ${key}.`);
      const expected_at = row.expected_at === null ? null : instant(row.expected_at, key);
      const received_at = row.received_at === null ? null : instant(row.received_at, key);
      const reference_date = row.reference_date === null ? null : calendar(row.reference_date, key);
      if ((received_at && (status !== 'verified' || received_at > generatedAt))
          || (status === 'not_required' && (expected_at || reference_date))
          || (reference_date && (key === 'quote' || reference_date > generatedAt.slice(0,10)))) throw new Error(`Cronologia della fonte Apex incoerente: ${key}.`);
      return [key,{status,expected_at,received_at,reference_date}];
    }));
  }

  function validateSnapshot(raw) {
    object(raw,'snapshot');
    if (raw.schema_version !== 2 || raw.mode !== 'simulation' || raw.strategy !== 'apex' || raw.execution_status !== 'ok') throw new Error('Snapshot della simulazione Apex non valido.');
    const generated_at = instant(raw.generated_at,'generazione');
    const market_as_of = instant(raw.market_as_of,'quotazione');
    const start_at = instant(raw.start_at,'inizio');
    if (start_at > market_as_of || market_as_of > generated_at) throw new Error('Intervallo Apex non valido.');
    const initial_eur = number(raw.initial_eur,'capitale iniziale',700,700);
    const accounts = normalizeAccounts(raw.accounts, initial_eur);
    const history = normalizeHistory(raw.history, accounts, start_at, market_as_of, initial_eur);
    const decision = normalizeDecision(raw.decision, start_at, generated_at);
    if (decision.indicators && ['no_trade','executed'].includes(decision.status)
        && outcomes[decision.indicators.action].target!==accounts[mainId].target_btc_pct) throw new Error('Azione e target Apex incoerenti.');
    const snapshot = {schema_version:2,mode:'simulation',strategy:'apex',execution_status:'ok',generated_at,market_as_of,start_at,initial_eur,accounts,history,decision};
    if (raw.monitoring !== undefined) snapshot.monitoring = normalizeMonitoring(raw.monitoring);
    if (raw.data_sources !== undefined) snapshot.data_sources = normalizeSources(raw.data_sources, generated_at);
    return snapshot;
  }

  function exposurePct(account) {
    if (!account || account.value_eur <= 0) return null;
    return Math.max(0, Math.min(100, (account.value_eur-account.cash_eur)/account.value_eur*100));
  }

  const targetText = target => target === null || target === undefined ? '—' : target === 100 ? '100% BTC' : '100% EUR';

  function createView({document, Chart, dateLabel, eur, signed}) {
    const $ = id => document.getElementById(id);
    const set = (id, value) => { $(id).textContent = value; };
    const pct = value => value.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
    const weightText = value => value.toLocaleString('it-IT',{maximumFractionDigits:1})+'%';
    const visible = new Set(models.map(model=>model.id));
    let chart = null, current = null;

    function portfolioCard(model, account) {
      const reference = model.id === benchmarkId;
      const pnl = account?.pnl_eur;
      const tone = pnl == null ? '' : pnl < 0 ? 'negative' : 'positive';
      return `<article class="card apex-account" style="--account-color:${model.color}">
        <h3>${model.name}</h3>
        <dl class="apex-account-values">
          <div><dt>Patrimonio</dt><dd>${account?eur(account.value_eur):'—'}</dd></div>
          <div><dt>Profitto / perdita</dt><dd class="${tone}">${pnl==null?'—':signed(pnl)} <small>${account?(account.return_pct>=0?'+':'')+pct(account.return_pct):''}</small></dd></div>
          <div><dt>Max drawdown</dt><dd>${account?pct(account.max_drawdown_pct):'—'}</dd></div>
          ${reference?'':`<div><dt>Ultimo target</dt><dd>${targetText(account?.target_btc_pct)}</dd></div>`}
        </dl>
      </article>`;
    }

    function renderComparison(snapshot) {
      set('apex-capital',snapshot?`${eur(snapshot.initial_eur,0)} virtuali per modello`:'Capitale simulato');
      set('apex-comparison-start',snapshot?dateLabel(snapshot.start_at,true):'—');
      set('apex-comparison-end',snapshot?dateLabel(snapshot.market_as_of,true):'—');
      const card = model => portfolioCard(model,snapshot?.accounts[model.id]);
      $('apex-primary-cards').innerHTML = models.slice(0,2).map(card).join('');
      $('apex-shadow-cards').innerHTML = models.slice(2).map(card).join('');
    }

    function signalLamp(key, title, active, label, decisive) {
      const state = active==null?'unknown':active?'on':'off';
      const highlighted = decisive.includes(key);
      const symbol = active==null?'·':active?'✓':'–';
      return `<li data-signal="${key}" data-active="${state}" data-decisive="${highlighted}">
        <span class="apex-lamp" aria-hidden="true">${symbol}</span><strong>${title}</strong><small>${label}</small>
        ${highlighted?'<span class="sr-only">Condizione decisiva</span>':''}
      </li>`;
    }

    function renderSignals(decision) {
      const checks = decision?.checks;
      const indicators = decision?.indicators;
      const decisive = indicators?.decisive ?? [];
      const unknown = decision?.decided_at?'Non registrata':'In attesa';
      const momentumLabel = active => active==null?unknown:active?'Positiva':'Spenta';
      $('apex-checks').innerHTML = Object.entries(shortSignals).map(([key,title])=>{
        const active = checks?.[key];
        const label = key==='above_sma200' && active!=null?(active?'Prezzo sopra':'Prezzo non sopra'):momentumLabel(active);
        return signalLamp(key,title,active,label,decisive);
      }).join('');
      $('apex-h2-checks').innerHTML = Object.entries(longSignals).map(([key,title])=>{
        const active = indicators?.[key];
        return signalLamp(key,title,active,momentumLabel(active),decisive);
      }).join('');
      const h2 = $('apex-h2-status');
      const h2State = indicators?.h2_positive;
      const informational = decision?.phase==='defence'?' · informativo':'';
      h2.textContent = (h2State==null?(decision?.decided_at?'Non registrato':'In attesa'):h2State?'Positivo':'Spento')+informational;
      h2.dataset.active = h2State==null?'unknown':h2State?'on':'off';
      h2.dataset.decisive = String(decisive.includes('h2_positive'));
      if (decisive.includes('h2_positive')) h2.setAttribute('aria-label',`${h2.textContent} · condizione decisiva`);
      else h2.removeAttribute('aria-label');
      const weak = checks?.weak_week_seen;
      const weekLabel = decision?.phase && decision.phase!=='defence'?'Fuori fase':weak==null?unknown:weak?'Osservata':'Da osservare';
      const within = indicators?.sma1400_within_limit;
      const ratio = indicators?.sma1400_ratio_pct;
      const floorLabel = decision?.phase==='defence'?'Fuori fase':ratio==null?unknown
        : !within && ratio<105.005?'Oltre 105%':`${ratio.toLocaleString('it-IT',{maximumFractionDigits:2})}% · ${within?'entro':'oltre'} 105%`;
      $('apex-context-checks').innerHTML = signalLamp('weak_week_seen','Settimana debole',weak,weekLabel,decisive)
        + signalLamp('sma1400_within_limit','Soglia SMA1400',within,floorLabel,decisive);
      $('apex-signal-legend').hidden = decisive.length===0;
    }

    function renderGauge(snapshot, historical) {
      const main = snapshot?.accounts[mainId];
      const decision = snapshot?.decision;
      const outcome = outcomes[decision?.indicators?.action];
      const exposure = exposurePct(main);
      set('apex-exposure',exposure===null?'—':weightText(exposure));
      const fill = $('apex-meter-fill');
      fill.style.strokeDasharray = `${exposure??0} 100`;
      fill.style.opacity = exposure ? '1' : '0';
      const needle = $('apex-meter-needle');
      needle.style.opacity = exposure===null ? '0' : '1';
      needle.style.transform = `rotate(${-205+2.3*(exposure??0)}deg)`;
      set('apex-phase',phases[decision?.phase]||'—');
      const status = $('apex-decision-status');
      const missedFill = decision?.status==='no_trade' && ['buy','sell'].includes(outcome?.tone);
      status.textContent = missedFill?'Nessuna operazione eseguita':decisionStatuses[decision?.status]||'In attesa della prima simulazione';
      status.dataset.tone = missedFill||['waiting_data','missed_week'].includes(decision?.status)?'warning':'ok';
      set('apex-action-caption',historical?'Ultima decisione registrata':'Decisione settimanale');
      $('apex-action-panel').dataset.tone = outcome?.tone ?? 'neutral';
      set('apex-action',outcome?.label ?? (decision?.status==='executed'?'Operazione eseguita':decision?.status==='no_trade'?'Nessuna operazione':'In attesa'));
      set('apex-target',targetText(outcome?.target ?? main?.target_btc_pct));
      set('apex-reference',decision?.reference_date ? decision.reference_date.split('-').reverse().join('/') : '—');
      set('apex-decided',decision?.decided_at ? dateLabel(decision.decided_at,true) : decision?.status==='waiting_data'?'In attesa':'—');
      set('apex-executed',decision?.executed_at ? dateLabel(decision.executed_at,true) : '—');
      set('apex-reason-title',outcome?.reason ?? 'Motivo della decisione');
      set('apex-decision-reason',decision?.reason||'');
      $('apex-reason-panel').hidden = !decision?.reason;
      renderSignals(decision);
    }

    const sourceTone = (status, historical) => historical ? 'neutral' : status === 'verified' ? 'ok' : status === 'waiting' ? 'warning' : 'neutral';

    function sourceRow(key, row, historical) {
      const {label,provider,verified,reference} = sources[key];
      const statuses = {verified,waiting:'In attesa',not_required:'Non necessario',not_checked:'Da verificare'};
      const status = row?.status;
      const day = row?.reference_date ? new Date(`${row.reference_date}T00:00:00Z`) : null;
      const name = key === 'close' && day?.getUTCDay() === 0 ? 'Chiusura BTC della domenica' : label;
      const detail = day ? ` · ${reference} ${sourceDateFormat.format(day)}` : '';
      const expected = row?.expected_at ? expectedFormat.format(new Date(row.expected_at)) : status === 'not_required' ? '—' : 'Non registrato';
      const received = row?.received_at ? receivedFormat.format(new Date(row.received_at)) : status === 'waiting' ? 'In attesa' : status === 'not_required' ? '—' : 'Non registrato';
      return `<li class="apex-feed-source" data-source="${key}" data-tone="${sourceTone(status,historical)}">
        <span class="apex-feed-dot" aria-hidden="true"></span>
        <div class="apex-feed-name"><strong>${name}</strong><span>${provider}${detail}</span></div>
        <span class="apex-feed-state">${statuses[status]||'Non registrato'}</span>
        <dl class="apex-feed-times"><div><dt>Atteso</dt><dd>${expected}</dd></div><div><dt>Ricevuto</dt><dd>${received}</dd></div></dl>
      </li>`;
    }

    function renderSources(snapshot, historical) {
      const data = snapshot?.data_sources;
      const decision = snapshot?.decision;
      const quoteReady = data?.quote.status === 'verified';
      const missed = decision?.status === 'missed_week';
      const waiting = !missed && (decision?.status === 'waiting_data' || (data && Object.values(data).some(row=>row.status==='waiting')));
      const decisionReady = !missed && !waiting && quoteReady && decision.reference_date
        && data.close.reference_date === decision.reference_date && data.close.status === 'verified' && data.fx.status === 'verified'
        && ['verified','not_required'].includes(data.blocks.status);
      set('apex-feed-as-of', snapshot ? `${historical?'Ultima rilevazione':'Rilevazione'} ${dateLabel(snapshot.generated_at,true)} · ora italiana` : 'In attesa della prima rilevazione · ora italiana');
      set('apex-feed-value', historical ? 'Ultimo dato noto' : quoteReady ? 'Aggiornato' : data?.quote.status==='waiting' ? 'In attesa' : 'Da verificare');
      set('apex-feed-decision', historical ? 'Ultimo stato noto' : missed ? 'Finestra trascorsa' : decisionReady ? 'Dati pronti' : waiting ? 'In attesa dati' : 'Da verificare');
      $('apex-feed-value').dataset.tone = sourceTone(data?.quote.status,historical);
      $('apex-feed-decision').dataset.tone = sourceTone(decisionReady?'verified':missed||waiting?'waiting':null,historical);
      const keys = Object.keys(sources);
      $('apex-feed-strip').innerHTML = keys.map(key=>`<span data-tone="${sourceTone(data?.[key].status,historical)}"></span>`).join('');
      $('apex-feed-sources').innerHTML = keys.map(key=>sourceRow(key,data?.[key],historical)).join('');
      const note = $('apex-feed-note');
      note.hidden = !!data && !historical;
      note.textContent = !snapshot ? 'Gli orari compariranno alla prima rilevazione.' : !data ? 'Gli orari delle fonti non sono registrati in questa rilevazione.' : 'Gli orari e gli stati si riferiscono alla rilevazione indicata.';
    }

    function renderChart(snapshot) {
      if (chart) { chart.destroy(); chart = null; }
      const panel = $('apex-chart');
      const legend = $('apex-chart-legend');
      const empty = $('apex-chart-empty');
      const isPnl = $('apex-chart-view').value === 'pnl';
      const account = snapshot?.accounts[mainId];
      set('apex-chart-value', account ? isPnl ? signed(account.pnl_eur) : eur(account.value_eur) : '—');
      set('apex-chart-note',isPnl?'Profitto / perdita · Apex':'Patrimonio · Apex');
      if (!snapshot || !Chart) {
        panel.hidden = legend.hidden = true;
        empty.hidden = false;
        set('apex-chart-empty', snapshot ? 'Grafico temporaneamente indisponibile.' : 'Il grafico si popola con le rilevazioni della simulazione.');
        return;
      }
      empty.hidden = true;
      panel.hidden = legend.hidden = false;
      legend.innerHTML = models.map(({id,short,color})=>
        `<button type="button" class="legend-btn ${visible.has(id)?'active':'off'}" data-model="${id}" aria-pressed="${visible.has(id)}"><i style="background:${color}" aria-hidden="true"></i>${short}</button>`).join('');
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role','img');
      canvas.setAttribute('aria-label',`${isPnl?'Profitto e perdita':'Patrimonio'} dei cinque portafogli simulati dal t0 comune`);
      panel.replaceChildren(canvas);
      const datasets = models.map(({id,short,color})=>({label:short,borderColor:color,backgroundColor:color,
        borderWidth:id===mainId?3:2,tension:0,pointRadius:snapshot.history.length===1?4:0,pointHoverRadius:4,hidden:!visible.has(id),
        data:snapshot.history.map(row=>({x:Date.parse(row.at),y:row.values_eur[id]-(isPnl?snapshot.initial_eur:0)})),
      }));
      const axisText = '#a7b7cb', grid = '#24354a';
      const pointAt = Date.parse(snapshot.history[0].at);
      const xBounds = snapshot.history.length===1 ? {min:pointAt-43200000,max:pointAt+43200000} : {};
      chart = new Chart(canvas,{type:'line',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
        interaction:{intersect:false,mode:'nearest',axis:'x'},
        plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items.length?dateLabel(items[0].parsed.x,true):'',label:item=>`${item.dataset.label} · ${eur(item.parsed.y)}`}}},
        scales:{x:{type:'linear',...xBounds,grid:{color:grid},ticks:{color:axisText,maxTicksLimit:4,callback:tick=>dateLabel(Number(tick))}},
          y:{grid:{color:grid},ticks:{color:axisText,maxTicksLimit:5,callback:tick=>eur(Number(tick),0)}}},
      }});
    }

    $('apex-chart-view').addEventListener('change',()=>renderChart(current));
    $('apex-chart-legend').addEventListener('click',event=>{
      const button = event.target.closest('[data-model]');
      if (!button || !chart) return;
      const id = button.dataset.model;
      const index = models.findIndex(model=>model.id===id);
      if (index === -1) return;
      const show = !visible.has(id);
      if (show) visible.add(id); else visible.delete(id);
      button.classList.toggle('active',show);
      button.classList.toggle('off',!show);
      button.setAttribute('aria-pressed',String(show));
      chart.setDatasetVisibility(index,show);
      chart.update('none');
    });

    return {
      render(snapshot, {historical=false} = {}) {
        renderGauge(snapshot,historical);
        renderSources(snapshot, historical);
        renderComparison(snapshot);
        if (current!==snapshot || !chart) renderChart(snapshot);
        current=snapshot;
      },
      hide() {
        if (chart) {chart.destroy();chart=null;}
      },
    };
  }

  const api = {validateSnapshot,exposurePct,targetText,createView};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.QuantApex = api;
})(typeof window !== 'undefined' ? window : globalThis);
