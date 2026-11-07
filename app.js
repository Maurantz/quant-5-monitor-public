/* Quant 5.0: read-only snapshot viewer and isolated, browser-local DCA sandbox. */
(function (global) {
  'use strict';
  const SYMBOLS = ['BTC', 'SOL', 'ETH', 'CRO'];
  const META = {BTC:{name:'Bitcoin',glyph:'₿',color:'#e7b160',target:.584,qty:.0077967,cost:569.67},SOL:{name:'Solana',glyph:'◎',color:'#a89ae8',target:.206,qty:3.6952,cost:341.44},ETH:{name:'Ethereum',glyph:'Ξ',color:'#7ba9e2',target:.151,qty:.09615,cost:250},CRO:{name:'Cronos',glyph:'C',color:'#647aeb',target:.059,qty:2036.72,cost:99.03}};
  // Base taker assumption checked 2026-10-30; imported fills retain actual fees.
  const FEE = .005;
  // GitHub Pages projects share one origin. Keep each installation's data in
  // its own path scope; origin-global legacy snapshots require manual import.
  const APP_SCOPE = typeof document === 'undefined' ? 'node' : new URL('./', document.baseURI).pathname;
  const STORAGE = `quant_5_snapshot_v2:${APP_SCOPE}`;
  const SANDBOX_STORAGE = `quant_5_sandbox_v2:${APP_SCOPE}`;
  const eur = (value, digits = 2) => Number(value).toLocaleString('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:digits,maximumFractionDigits:digits});
  const num = (value, digits = 2) => Number(value).toLocaleString('it-IT',{maximumFractionDigits:digits});
  const signed = value => `${value >= 0 ? '+' : '−'}${eur(Math.abs(value))}`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = (value, label, min = -Infinity, max = Infinity) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Campo non valido: ${label}.`);
    return value;
  };
  const timestamp = (value, label) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Data non valida: ${label}.`);
    calendarDate(value.slice(0,10),label);
    return new Date(value).toISOString();
  };
  const calendarDate = (value, label) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) throw new Error(`Data non valida: ${label}.`);
    return value;
  };
  const nullable = (value, label, min = -Infinity, max = Infinity) => value == null ? null : finite(value,label,min,max);
  const text = value => typeof value === 'string' ? value.slice(0,1000) : '';
  const clone = value => JSON.parse(JSON.stringify(value));
  /** Classify both source dates without changing them or trusting the device clock as a source. */
  function snapshotTiming(current, now = Date.now()) {
    const timing = {invalid:false,stale:false,future:false};
    if (typeof now !== 'number' || !Number.isFinite(now)) return {...timing,invalid:true};
    const sourceDates=['generated_at','market_as_of'].map(key=>({key,value:current?.[key]}));
    if (current?.strategy==='mom300') {
      const day=current.metrics?.mom300?.t1_date;
      sourceDates.push({key:'chiusura del segnale',value:typeof day==='string'?`${day}T23:59:59.999Z`:null});
    }
    for (const {key,value:sourceDate} of sourceDates) {
      let value;
      try { value=Date.parse(timestamp(sourceDate,key)); }
      catch { timing.invalid=true; continue; }
      if (value < now-36*3600*1000) timing.stale=true;
      if (value > now+5*60*1000) timing.future=true;
    }
    return timing;
  }
  function snapshotPresentation(current, {source='server',online=true,syncFailed=false,now=Date.now()} = {}) {
    const timing=snapshotTiming(current,now),demo=source==='demo';
    const offline=source==='cache'||!online||Boolean(syncFailed);
    const halted=current.execution_status==='halted';
    const monitoringProblem=current.monitoring?.status && current.monitoring.status!=='ok';
    return {timing,offline,halted,historical:!demo&&(offline||halted||monitoringProblem||timing.invalid||timing.stale||timing.future),
      pnlLabel:demo?'P&L demo':current.mode==='simulation'?'P&L simulato':'P&L dello snapshot',
      pnlContext:demo?'Valori ipotetici della demo locale.':current.mode==='simulation'?'Risultato di operazioni simulate, ante imposte. Non dimostra un vantaggio della strategia.':''};
  }
  function sandboxFeeNote() {
    const fee=FEE.toLocaleString('it-IT',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2});
    return `Esempi ipotetici ai prezzi iniziali. Commissione simulata ${fee} per acquisto. Le modifiche restano su questo dispositivo e non alterano gli snapshot del motore.`;
  }
  function engineCards(current, presentation) {
    if (current.strategy === 'mom300') {
      const mom = current.metrics.mom300 || {};
      const isBull = mom.signal === 1;
      const retPct = mom.return != null ? (mom.return * 100).toFixed(2) + '%' : 'n.d.';
      const details=current.strategy_details,waiting=Boolean(details?.awaiting_rebalance);
      const engines = [
        {name:'mom300 Pura',icon:'⚡',description:'Se Close t-1 > Close t-301 il target è 100% BTC, altrimenti 100% liquidità EUR. Il segnale usa chiusure giornaliere già completate.',status:`Mom300: ${retPct} · ${isBull ? 'Target 100% BTC' : 'Target 100% EUR'}`,tone:isBull?'enabled':'warning'},
        {name:'Rotazione Settimanale',icon:'⇄',description:'Controllo allocazione ogni lunedì con soglia di tolleranza 5% per evitare turnover inutile.',status:waiting?`Nuovo segnale: attesa del prossimo lunedì (${details.next_rebalance_date}). Target deliberato: ${details.last_decision_signal===1?'100% BTC':'100% EUR'}.`:'Controllo periodico ogni lunedì',tone:waiting?'warning':'enabled'},
        {name:'Gestione esposizione',icon:'🛡️',description:'Un segnale non positivo richiede un target EUR. Vendite, costi, residui e calendario possono lasciare un’esposizione BTC diversa dal target.',status:isBull?'Il target comporta esposizione al prezzo BTC':'Target difensivo EUR · controllare le posizioni effettive',tone:isBull?'':'warning'},
      ];
      if (!presentation.historical) return engines;
      return engines.map(engine=>({...engine,tone:'warning',status:presentation.halted?'Esecuzione bloccata · segnale non attuale':'Dati dello snapshot · segnale non attuale'}));
    }
    const r=current.metrics.risk,p=current.portfolio,known=r!=null;
    const activeTrails=p.assets.filter(a=>a.trailing_stop_eur!=null).length;
    const engines=[
      {name:'Smart DCA',icon:'↗',description:'Il primo del mese. Rata da 100 € e riserva a due livelli, fino a esaurimento del piano.',status:!known?'In attesa del segnale':p.installments_completed>=4?'Piano completato':r>68?'Rata sospesa':r<20?`Fino a ${eur(Math.min(100,p.dca_remaining_eur)+Math.min(100,p.reserve_remaining_eur),0)} su BTC`:r<30?`Fino a ${eur(Math.min(100,p.dca_remaining_eur)+Math.min(50,p.reserve_remaining_eur),0)} su BTC`:r<45&&current.metrics.rel_30d.SOL>0?'Momentum · 70% BTC / 30% SOL':'Accumulo · BTC',tone:!known?'':r>68?'warning':'enabled'},
      {name:'Rebalancing a soglia',icon:'⇄',description:'Ogni lunedì. Eccedenza oltre il +15% relativo al target, conversione diretta in BTC.',status:!known?'In attesa dello snapshot':r>=75?'Sospeso in zona euforia':'Controllo ogni lunedì',tone:!known?'':r>=75?'warning':'enabled'},
      {name:'Scudo forza relativa',icon:'◇',description:'Ogni lunedì. Se ALT perde almeno 15 punti vs BTC a 30 giorni, converte il 50% in BTC.',status:!known?'In attesa delle metriche':r>=75?'Sospeso in zona euforia':'Attivo sotto rischio 75',tone:!known?'':r>=75?'warning':'enabled'},
      {name:'Uscita 50/50 + trailing',icon:'⌁',description:'Da rischio 75: metà altcoin in EUR. CRO via BTC → EUR in due esecuzioni. Sul residuo, trailing giornaliero del 12%.',status:activeTrails?`${activeTrails} trailing attivi`:!known?'In attesa del segnale':r>=75?'Zona di uscita · verifica operazioni':'In attesa della soglia 75',tone:activeTrails?'enabled':r>=75?'critical':''}
    ];
    if (!presentation.historical) return engines;
    return engines.map(engine=>({...engine,tone:'warning',status:presentation.halted?'Esecuzione bloccata · segnale non attuale':'Dati dello snapshot · segnale non attuale'}));
  }
  function demoSnapshot() {
    const assets = SYMBOLS.map(symbol => {
      const m = META[symbol];
      return {symbol,quantity:m.qty,cost_basis_eur:m.cost,price_eur:m.cost/m.qty,value_eur:m.cost,pmc_eur:m.cost/m.qty,pnl_eur:0,weight:m.cost/1260.14,target_weight:m.target,max_weight:m.target*1.15,trailing_stop_eur:null,high_water_eur:null};
    });
    return {schema_version:1,mode:'simulation',generated_at:null,market_as_of:null,metrics:{risk:null,rsi:null,wma_ratio:null,fng:null,prices:Object.fromEntries(assets.map(a => [a.symbol,a.price_eur])),rel_30d:{SOL:null,ETH:null,CRO:null}},portfolio:{contributed_eur:1760.14,cash_eur:500,dca_remaining_eur:400,reserve_remaining_eur:100,installments_completed:0,total_value_eur:1760.14,pnl_eur:0,pnl_pct:0,realized_pnl_eur:0,fees_eur:0,assets},actions:[],history:[],warnings:[]};
  }
  /** Allowlist all exported fields. Imported documents never add markup, credentials, or settings. */
  function validateSnapshot(raw) {
    if (!raw || raw.schema_version !== 1 || !['simulation','live'].includes(raw.mode)) throw new Error('Snapshot non supportato. È richiesto lo schema Quant 5.0 versione 1.');
    const executionStatus=raw.execution_status===undefined?'ok':raw.execution_status;
    if(!['ok','halted'].includes(executionStatus))throw new Error('Stato di esecuzione dello snapshot non valido.');
    const generatedAt=timestamp(raw.generated_at,'generazione'),marketAsOf=timestamp(raw.market_as_of,'mercato');
    const m = raw.metrics, p = raw.portfolio;
    if (raw.strategy !== undefined && !['legacy','mom300'].includes(raw.strategy)) throw new Error('Strategia dello snapshot non supportata.');
    const isMom300 = raw.strategy === 'mom300';
    const expectedAssetCount = isMom300 ? 1 : 4;
    if (!m || !p || !Array.isArray(p.assets) || p.assets.length !== expectedAssetCount) throw new Error('Snapshot incompleto: metriche o portafoglio assenti.');
    const metrics = {risk:isMom300?nullable(m.risk,'rischio',0,100):finite(m.risk,'rischio',0,100),rsi:isMom300?nullable(m.rsi,'RSI',0,100):finite(m.rsi,'RSI',0,100),wma_ratio:isMom300?nullable(m.wma_ratio,'rapporto 200W',0):finite(m.wma_ratio,'rapporto 200W',0),fng:isMom300?nullable(m.fng,'Fear & Greed',0,100):finite(m.fng,'Fear & Greed',0,100),prices:{},rel_30d:{}};
    if (isMom300) {
      if (!m.mom300 || typeof m.mom300 !== 'object' || ![0,1].includes(m.mom300.signal)) throw new Error('Segnale mom300 mancante o non binario.');
      metrics.mom300 = {
        return: finite(m.mom300.return, 'mom300.return'),
        signal: finite(m.mom300.signal, 'mom300.signal', 0, 1),
        target_label: text(m.mom300.target_label || ''),
        t1_date: calendarDate(m.mom300.t1_date, 'mom300.t1_date'),
        t301_date: calendarDate(m.mom300.t301_date, 'mom300.t301_date'),
        close_t1: finite(m.mom300.close_t1, 'mom300.close_t1', Number.MIN_VALUE),
        close_t301: finite(m.mom300.close_t301, 'mom300.close_t301', Number.MIN_VALUE),
        days_interval: finite(m.mom300.days_interval, 'mom300.days_interval', 300, 300),
      };
      const mom=metrics.mom300,expected=(mom.close_t1-mom.close_t301)/mom.close_t301;
      if (Date.parse(`${mom.t1_date}T00:00:00Z`)-Date.parse(`${mom.t301_date}T00:00:00Z`)!==300*86400000 || Math.abs(expected-mom.return)>1e-8 || mom.signal!==(expected>0?1:0)) throw new Error('Date, rendimento e segnale mom300 incoerenti.');
      if(mom.t1_date>=generatedAt.slice(0,10))throw new Error('Il segnale usa una candela non ancora chiusa alla generazione dello snapshot.');
      mom.target_label=mom.signal===1?'100% BTC':'100% Cash EUR';
    }
    let strategyDetails;
    if (isMom300&&raw.strategy_details!==undefined) {
      const d=raw.strategy_details;
      if (!d||typeof d!=='object'||Array.isArray(d)) throw new Error('Dettagli della strategia non validi.');
      strategyDetails={};
      ['name','asset','rebalance_cadence','description'].forEach(k=>{if(d[k]!==undefined)strategyDetails[k]=text(d[k]);});
      if(d.lookback_days!==undefined)strategyDetails.lookback_days=finite(d.lookback_days,'lookback strategia',300,300);
      if(d.band_pct!==undefined)strategyDetails.band_pct=finite(d.band_pct,'banda strategia',5,5);
      if (['last_decision_at','last_decision_signal','next_rebalance_date','awaiting_rebalance'].some(k=>d[k]!==undefined)) {
        if(![0,1].includes(d.last_decision_signal)||typeof d.awaiting_rebalance!=='boolean')throw new Error('Decisione settimanale non valida.');
        const last=d.last_decision_at==null?null:timestamp(d.last_decision_at,'ultima decisione');
        const next=calendarDate(d.next_rebalance_date,'prossimo controllo');
        if(new Date(`${next}T00:00:00Z`).getUTCDay()!==1||Date.parse(`${next}T00:00:00Z`)<Date.parse(`${generatedAt.slice(0,10)}T00:00:00Z`)||(last&&Date.parse(last)>Date.parse(generatedAt)))throw new Error('Calendario della decisione settimanale incoerente.');
        const awaiting=last!==null&&d.last_decision_signal!==metrics.mom300.signal;
        if(d.awaiting_rebalance!==awaiting||(!last&&d.last_decision_signal!==metrics.mom300.signal))throw new Error('Attesa di ribilanciamento incoerente con il segnale giornaliero.');
        Object.assign(strategyDetails,{last_decision_at:last,last_decision_signal:d.last_decision_signal,next_rebalance_date:next,awaiting_rebalance:awaiting});
      }
    }
    const validSymbols = isMom300 ? ['BTC'] : SYMBOLS;
    if (isMom300) {
      metrics.prices.BTC = finite(m.prices?.BTC, 'prezzo BTC', Number.MIN_VALUE);
    } else {
      SYMBOLS.forEach(s => { metrics.prices[s] = finite(m.prices?.[s],`prezzo ${s}`,Number.MIN_VALUE); });
      ['SOL','ETH','CRO'].forEach(s => { metrics.rel_30d[s] = finite(m.rel_30d?.[s],`forza relativa ${s}`); });
    }
    const seen = new Set();
    const assets = p.assets.map(a => {
      if (!a || !validSymbols.includes(a.symbol) || seen.has(a.symbol)) throw new Error('Elenco degli asset non valido.');
      seen.add(a.symbol);
      const asset = {symbol:a.symbol};
      ['quantity','cost_basis_eur','price_eur','value_eur','weight'].forEach(k => {asset[k]=finite(a[k],`${a.symbol}.${k}`,0);});
      asset.pmc_eur=asset.quantity===0?nullable(a.pmc_eur,`${a.symbol}.pmc_eur`,0):finite(a.pmc_eur,`${a.symbol}.pmc_eur`,0);
      asset.pnl_eur=finite(a.pnl_eur,`${a.symbol}.pnl_eur`);
      // Strategy thresholds come from the documented rules, never from untrusted input.
      if (isMom300) {
        const momSig = strategyDetails?.last_decision_signal??metrics.mom300.signal;
        if(strategyDetails?.last_decision_signal!==undefined&&a.target_weight!==undefined&&a.target_weight!==momSig)throw new Error('Target BTC incoerente con la decisione settimanale.');
        asset.target_weight = momSig === 1 ? 1.0 : 0.0;
        asset.max_weight = 1.0;
      } else {
        asset.target_weight=META[a.symbol].target; asset.max_weight=META[a.symbol].target*1.15;
      }
      asset.trailing_stop_eur=nullable(a.trailing_stop_eur,'trailing stop',0);asset.high_water_eur=nullable(a.high_water_eur,'massimo trailing',0);
      if(a.symbol==='BTC'&&a.core_quantity!==undefined){
        ['core_quantity','core_cost_basis_eur','route_reserved_quantity','route_dust_quantity'].forEach(k=>{asset[k]=finite(a[k],`BTC.${k}`,0);});
        asset.core_pmc_eur=asset.core_quantity===0?nullable(a.core_pmc_eur,'BTC.core_pmc_eur',0):finite(a.core_pmc_eur,'BTC.core_pmc_eur',0);
        if(Math.abs(asset.core_quantity+asset.route_reserved_quantity+asset.route_dust_quantity-asset.quantity)>1e-8)throw new Error('Allocazioni BTC incoerenti con la quantità totale.');
      }
      if (Math.abs(asset.value_eur-asset.quantity*asset.price_eur) > Math.max(.03,asset.value_eur*1e-12)) throw new Error(`Valore e quantità incoerenti per ${a.symbol}.`);
      if (Math.abs(asset.price_eur-metrics.prices[a.symbol])>Math.max(1e-8,Math.abs(asset.price_eur)*1e-10)
          || Math.abs(asset.value_eur-asset.cost_basis_eur-asset.pnl_eur)>.03
          || (!asset.quantity&&asset.cost_basis_eur!==0)
          || (asset.quantity&&Math.abs(asset.quantity*asset.pmc_eur-asset.cost_basis_eur)>.03)) throw new Error(`Prezzo, costo medio o P&L incoerenti per ${a.symbol}.`);
      return asset;
    }).sort((a,b) => validSymbols.indexOf(a.symbol)-validSymbols.indexOf(b.symbol));
    const portfolio={assets};
    ['contributed_eur','cash_eur','dca_remaining_eur','reserve_remaining_eur','total_value_eur'].forEach(k => {portfolio[k]=finite(p[k],k,0);});
    ['pnl_eur','pnl_pct','realized_pnl_eur'].forEach(k => {portfolio[k]=finite(p[k] ?? 0,k);});
    portfolio.fees_eur=finite(p.fees_eur??0,'commissioni totali',0);
    portfolio.installments_completed=finite(p.installments_completed,'rate completate',0,4);
    if (!Number.isInteger(portfolio.installments_completed)) throw new Error('Numero di rate non valido.');
    const assetTotal=assets.reduce((sum,a)=>sum+a.value_eur,0);
    if (Math.abs(assetTotal+portfolio.cash_eur-portfolio.total_value_eur) > .1) throw new Error('Il totale del patrimonio non corrisponde agli asset e alla liquidità.');
    if (portfolio.dca_remaining_eur+portfolio.reserve_remaining_eur > portfolio.cash_eur+.02) throw new Error('La liquidità strategica supera il saldo disponibile.');
    if (Math.abs(portfolio.total_value_eur-portfolio.contributed_eur-portfolio.pnl_eur) > .1) throw new Error('P&L e capitale versato non corrispondono al patrimonio.');
    const expectedPct=portfolio.contributed_eur?portfolio.pnl_eur/portfolio.contributed_eur*100:0;
    if (Math.abs(expectedPct-portfolio.pnl_pct) > .05) throw new Error('La percentuale P&L non corrisponde al capitale versato.');
    if(isMom300&&Math.abs(portfolio.cash_eur+assets[0].cost_basis_eur-portfolio.realized_pnl_eur-portfolio.contributed_eur)>.1)throw new Error('Costo BTC, liquidità e P&L realizzato non conservano il capitale.');
    assets.forEach(a=>{a.weight=isMom300?(portfolio.total_value_eur?a.value_eur/portfolio.total_value_eur:0):(assetTotal?a.value_eur/assetTotal:0);});
    const actions=(Array.isArray(raw.actions)?raw.actions:[]).slice(-200).map(a => ({time:timestamp(a.time,'operazione'),reason:text(a.reason),instrument:text(a.instrument),side:text(a.side),quantity:nullable(a.quantity,'quantità operazione',0),notional:nullable(a.notional,'controvalore operazione',0),status:text(a.status),fee_eur:nullable(a.fee_eur,'commissione',0)}));
    if(raw.history!==undefined&&!Array.isArray(raw.history))throw new Error('Storico dello snapshot non valido.');
    const history=(raw.history||[]).slice(-2000).map(h=>({
      time:timestamp(h.time,'storico'),
      value_eur:finite(h.value_eur,'valore storico',0),
      contributed_eur:finite(h.contributed_eur,'capitale storico',0),
      benchmark_btc_val:nullable(h.benchmark_btc_val,'valore storico BTC passivo',0),
      benchmark_btc_pnl:nullable(h.benchmark_btc_pnl,'P&L storico BTC passivo'),
      drawdown_pct:nullable(h.drawdown_pct,'drawdown storico',-100,0),
      benchmark_drawdown_pct:nullable(h.benchmark_drawdown_pct,'drawdown storico BTC passivo',-100,0)
    }));
    history.forEach((h,i)=>{
      if(Date.parse(h.time)>Date.parse(generatedAt)||(i>0&&Date.parse(h.time)<=Date.parse(history[i-1].time)))throw new Error('Storico duplicato, fuori ordine o successivo allo snapshot.');
      if ((h.benchmark_btc_val===null)!==(h.benchmark_btc_pnl===null) || (h.benchmark_btc_val!==null && Math.abs(h.benchmark_btc_val-h.contributed_eur-h.benchmark_btc_pnl)>.11)) throw new Error('Benchmark storico incoerente.');
    });
    const lastPoint=history.at(-1),currentPoint=lastPoint?.time===generatedAt?lastPoint:null;
    if(currentPoint&&(Math.abs(currentPoint.value_eur-portfolio.total_value_eur)>.1||Math.abs(currentPoint.contributed_eur-portfolio.contributed_eur)>.1))throw new Error('Ultimo punto del grafico incoerente con il patrimonio corrente.');
    if(raw.exit_routes!==undefined&&!Array.isArray(raw.exit_routes))throw new Error('Elenco delle conversioni CRO non valido.');
    const exitRoutes=(raw.exit_routes||[]).slice(-200).map(route=>{
      if(!route||typeof route.id!=='string'||!route.id||route.source_symbol!=='CRO'||!['planned','btc_received','completed','completed_with_dust','requires_review'].includes(route.status))throw new Error('Stato della conversione CRO non valido.');
      const normalized={id:text(route.id),status:route.status,reason:text(route.reason),source_symbol:'CRO',created_at:timestamp(route.created_at,'conversione CRO')};
      ['source_quantity','btc_received','btc_reserved','btc_dust','btc_reserved_cost_basis_eur','eur_received'].forEach(k=>{normalized[k]=finite(route[k],`conversione CRO.${k}`,0);});
      if(route.source_dust_quantity!==undefined)normalized.source_dust_quantity=finite(route.source_dust_quantity,'residuo CRO',0);
      return normalized;
    });
    const normalizedSnapshot = {schema_version:1,mode:raw.mode,strategy:raw.strategy||'legacy',execution_status:executionStatus,generated_at:generatedAt,market_as_of:marketAsOf,metrics,portfolio,actions,history,exit_routes:exitRoutes,warnings:(Array.isArray(raw.warnings)?raw.warnings:[]).filter(x=>typeof x==='string').slice(0,30).map(text)};
    if(strategyDetails)normalizedSnapshot.strategy_details=strategyDetails;
    if (raw.monitoring!==undefined) {
      const monitoring=raw.monitoring;
      if (!monitoring || !['ok','failed','updating','stale','bootstrap'].includes(monitoring.status)) throw new Error('Stato del monitoraggio non valido.');
      normalizedSnapshot.monitoring={status:monitoring.status,message:text(monitoring.message)};
      if(monitoring.last_attempt_at!=null) normalizedSnapshot.monitoring.last_attempt_at=timestamp(monitoring.last_attempt_at,'ultimo tentativo');
      if(monitoring.source_run_id!=null) normalizedSnapshot.monitoring.source_run_id=text(String(monitoring.source_run_id));
      for(const key of ['source_url','url']) {
        if(typeof monitoring[key]==='string'&&/^https:\/\/github\.com\/Maurantz\/quant-5-crypto-bot\/actions\/runs\/\d+$/.test(monitoring[key])) normalizedSnapshot.monitoring[key]=monitoring[key];
      }
    }
    if (raw.benchmark && typeof raw.benchmark === 'object') {
      const b=raw.benchmark,benchmark={initial_btc_price:finite(b.initial_btc_price,'prezzo BTC iniziale benchmark',Number.MIN_VALUE),current_btc_value_eur:finite(b.current_btc_value_eur,'valore BTC passivo',0)};
      ['pnl_eur','pnl_pct','alpha_eur'].forEach(k=>{benchmark[k]=finite(b[k],`benchmark.${k}`);});
      ['portfolio_max_drawdown_pct','benchmark_max_drawdown_pct','portfolio_current_drawdown_pct','benchmark_current_drawdown_pct'].forEach(k=>{benchmark[k]=finite(b[k],`benchmark.${k}`,-100,0);});
      if (Math.abs(benchmark.current_btc_value_eur-portfolio.contributed_eur-benchmark.pnl_eur)>.11 || Math.abs(portfolio.total_value_eur-benchmark.current_btc_value_eur-benchmark.alpha_eur)>.11 || Math.abs((portfolio.contributed_eur?benchmark.pnl_eur/portfolio.contributed_eur*100:0)-benchmark.pnl_pct)>.06) throw new Error('Valori del benchmark e confronto con il portafoglio incoerenti.');
      if (b.status!==undefined) {
        if (!['tracking','legacy_partial'].includes(b.status)) throw new Error('Stato del benchmark non supportato.');
        benchmark.status=b.status;
      }
      if (b.start_at!==undefined) benchmark.start_at=timestamp(b.start_at,'inizio benchmark');
      if (b.fee_rate!==undefined) benchmark.fee_rate=finite(b.fee_rate,'commissione benchmark',0,1);
      if (b.history_complete!==undefined) {
        if(typeof b.history_complete!=='boolean') throw new Error('Copertura dello storico benchmark non valida.');
        benchmark.history_complete=b.history_complete;
      }
      for(const [prefix,field] of [['portfolio','drawdown_pct'],['benchmark','benchmark_drawdown_pct']]){
        const maximum=benchmark[`${prefix}_max_drawdown_pct`],current=benchmark[`${prefix}_current_drawdown_pct`];
        if(maximum>current+.011||history.some(h=>h[field]!==null&&maximum>h[field]+.011)
            ||(currentPoint?.[field]!=null&&Math.abs(current-currentPoint[field])>.011))throw new Error('Drawdown corrente, massimo e storico incoerenti.');
        const valueField=prefix==='portfolio'?'value_eur':'benchmark_btc_val';
        let observedPeak=portfolio.contributed_eur,observedWorst=0;
        for(const h of history){if(h[valueField]===null)continue;observedPeak=Math.max(observedPeak,h[valueField]);const observed=observedPeak?(h[valueField]/observedPeak-1)*100:0;observedWorst=Math.min(observedWorst,observed);if(h[field]!==null&&h[field]>observed+.02)throw new Error('Drawdown storico inferiore al calo osservato.');}
        const currentValue=prefix==='portfolio'?portfolio.total_value_eur:benchmark.current_btc_value_eur;
        observedPeak=Math.max(observedPeak,currentValue);
        const observedCurrent=observedPeak?(currentValue/observedPeak-1)*100:0;
        if(current>observedCurrent+.02||maximum>Math.min(observedWorst,observedCurrent)+.02)throw new Error('Drawdown dichiarato inferiore ai cali osservati.');
      }
      if(currentPoint?.benchmark_btc_val!=null&&Math.abs(currentPoint.benchmark_btc_val-benchmark.current_btc_value_eur)>.11)throw new Error('Ultimo punto BTC passivo incoerente con il benchmark corrente.');
      if(isMom300&&benchmark.status==='tracking'&&benchmark.fee_rate!==undefined){
        const expected=portfolio.contributed_eur/benchmark.initial_btc_price*(1-benchmark.fee_rate)*metrics.prices.BTC;
        if(!Number.isFinite(expected)||Math.abs(expected-benchmark.current_btc_value_eur)>.11)throw new Error('Benchmark BTC incoerente con il prezzo iniziale e le commissioni.');
      }
      if (b.note!==undefined) benchmark.note=text(b.note);
      normalizedSnapshot.benchmark=benchmark;
    }
    return normalizedSnapshot;
  }
  function historySeries(current,isPnl=false) {
    const history=current.history;
    const hasBenchmark=current.strategy==='mom300'&&Boolean(current.benchmark)&&history.some(h=>h.benchmark_btc_val!==null&&h.benchmark_btc_val!==undefined);
    return {hasBenchmark,values:history.map(h=>isPnl?h.value_eur-h.contributed_eur:h.value_eur),
      benchmark:history.map(h=>hasBenchmark?(isPnl?h.benchmark_btc_pnl:h.benchmark_btc_val):null)};
  }
  function newSandbox() {
    const d=demoSnapshot();
    return {assets:clone(d.portfolio.assets),cash_eur:500,dca_remaining_eur:400,reserve_remaining_eur:100,contributed_eur:1760.14,installments_completed:0,months:[],fees_eur:0,events:[]};
  }
  /** Pure transition: caller only persists after a successful, fully validated monthly action. */
  function simulateDca(original, month, risk, relative) {
    finite(risk,'rischio',0,100);finite(relative,'forza relativa',-100,10000);
    if (!Number.isInteger(risk) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Inserisci un mese valido e un indice di rischio intero.');
    if (original.months.includes(month)) throw new Error('Il mese selezionato è già stato registrato nella simulazione.');
    if (original.installments_completed >= 4 || original.dca_remaining_eur <= 0) throw new Error('Le quattro rate del piano sono esaurite.');
    const s=clone(original);s.months.push(month);
    if (risk > 68) return {state:s,message:`${month}: rata congelata (rischio > 68). Nessuna spesa.`,spent:0};
    const base=Math.min(100,s.dca_remaining_eur);
    const reserve=Math.min(risk<20?100:risk<30?50:0,s.reserve_remaining_eur);
    const total=base+reserve;
    const momentum=risk>=30 && risk<45 && relative>0;
    const legs=momentum?[['BTC',total*.7],['SOL',total*.3]]:[['BTC',total]];
    for (const [symbol,amount] of legs) {
      const a=s.assets.find(a=>a.symbol===symbol),fee=amount*FEE;
      a.quantity+=(amount-fee)/a.price_eur;a.cost_basis_eur+=amount;a.value_eur=a.quantity*a.price_eur;a.pmc_eur=a.cost_basis_eur/a.quantity;a.pnl_eur=a.value_eur-a.cost_basis_eur;s.fees_eur+=fee;
    }
    s.cash_eur-=total;s.dca_remaining_eur-=base;s.reserve_remaining_eur-=reserve;s.installments_completed++;
    const crypto=s.assets.reduce((sum,a)=>sum+a.value_eur,0);s.assets.forEach(a=>{a.weight=crypto?a.value_eur/crypto:0;});
    const message=`${month}: ${legs.map(([symbol,amount])=>`${eur(amount)} ${symbol}`).join(' + ')} · commissioni ${eur(total*FEE,3)}.`;
    s.events.push(message);
    return {state:s,message,spent:total};
  }
  global.Quant5={demoSnapshot,validateSnapshot,newSandbox,simulateDca,snapshotTiming,snapshotPresentation,engineCards,sandboxFeeNote,historySeries,META};
  if (typeof module!=='undefined' && module.exports) module.exports=global.Quant5;
  if (typeof document==='undefined') return;

  const $=id=>document.getElementById(id);
  let snapshot=demoSnapshot(),source='demo',fetchFailure='',busy=false,lineChart=null,installPrompt=null,lastRefreshAttempt=0,sourceVersion=0,importSelectionVersion=0;
  let sandbox=newSandbox();
  const storageRead=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  const storageWrite=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{/* App remains usable when storage is blocked/full. */}};
  const saved=storageRead(STORAGE);
  if (saved) {
    try {
      snapshot=validateSnapshot(saved.snapshot);
      if (snapshot.strategy === 'mom300' && snapshot.portfolio.assets.length !== 1) {
        throw new Error('Stale mom300 cache');
      }
      source=saved.source==='import'||snapshot.mode!=='simulation'||snapshot.strategy!=='mom300'?'import':'cache';
    } catch {
      try { localStorage.removeItem(STORAGE); } catch {}
    }
  }
  const savedSandbox=storageRead(SANDBOX_STORAGE);
  if (savedSandbox) {
    try {
      if (Array.isArray(savedSandbox.months) && savedSandbox.months.length<=240 && savedSandbox.months.every(m=>typeof m==='string') && Array.isArray(savedSandbox.events) && Array.isArray(savedSandbox.assets) && savedSandbox.assets.length===4 && SYMBOLS.every(x=>savedSandbox.assets.some(a=>a.symbol===x))) {
        ['cash_eur','dca_remaining_eur','reserve_remaining_eur','contributed_eur','fees_eur','installments_completed'].forEach(k=>finite(savedSandbox[k],k,0));
        savedSandbox.assets.forEach(a=>['quantity','price_eur','cost_basis_eur','value_eur'].forEach(k=>finite(a[k],k,0)));
        savedSandbox.assets.forEach(a=>finite(a.price_eur,'prezzo demo',Number.MIN_VALUE));
        if (savedSandbox.installments_completed<=4 && savedSandbox.dca_remaining_eur<=400 && savedSandbox.reserve_remaining_eur<=100) sandbox=savedSandbox;
      }
    }catch{/* Keep a clean simulation if local storage is damaged. */}
  }
  function feedback(message,error=false) {$('feedback').textContent=message;$('feedback').classList.toggle('error',error);$('feedback').hidden=!message;}
  function dateLabel(value,withTime=false) {return new Date(value).toLocaleString('it-IT',withTime?{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}:{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Rome'});}
  function zone(risk) {
    if(risk==null)return ['In attesa','neutral','Importa uno snapshot per leggere il segnale del motore.'];
    if(risk<20)return ['Panico estremo','warning','Capitolazione: rata e riserva fino a 200 € su BTC.'];
    if(risk<30)return ['Sconto forte','warning','Rata e riserva di livello 1: fino a 150 € su BTC.'];
    if(risk<=68)return ['Accumulo','positive','Zona di accumulo. DCA standard o momentum SOL.'];
    if(risk<75)return ['Zona calda','warning','Acquisti mensili sospesi. Capitale in liquidità.'];
    return ['Euforia','negative','Uscita altcoin 50% e trailing stop sul residuo.'];
  }
  function renderComparison(presentation) {
    const panel=$('comparison-summary'),p=snapshot.portfolio,b=snapshot.benchmark;
    panel.hidden=snapshot.strategy!=='mom300';
    if(panel.hidden)return;
    const percentage=value=>`${value>=0?'+':''}${Number(value).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
    const profit=(id,value)=>{const element=$(id);element.textContent=signed(value);element.className=`comparison-value ${value<0?'negative':'positive'}`;};
    const drawdown=(id,value)=>{const element=$(id);element.textContent=value==null?'—':`${Math.abs(value).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;element.className=`comparison-value ${value<0?'negative':''}`;};
    $('comparison-start').textContent=b?.start_at?dateLabel(b.start_at,true):'Avvio non disponibile';
    $('comparison-end').textContent=snapshot.generated_at?dateLabel(snapshot.generated_at,true):'Non disponibile';
    $('comparison-mode').textContent=snapshot.mode==='simulation'?'Simulazione':'Snapshot live';
    profit('comparison-mom-profit',p.pnl_eur);
    $('comparison-mom-return').textContent=percentage(p.pnl_pct);
    drawdown('comparison-mom-drawdown',b?.portfolio_max_drawdown_pct);
    if(b){
      profit('comparison-btc-profit',b.pnl_eur);
      $('comparison-btc-return').textContent=percentage(b.pnl_pct);
    }else{
      $('comparison-btc-profit').textContent='—';$('comparison-btc-profit').className='comparison-value';
      $('comparison-btc-return').textContent='Non disponibile';
    }
    drawdown('comparison-btc-drawdown',b?.benchmark_max_drawdown_pct);
    const note=[snapshot.mode==='simulation'?'Profitti simulati, commissioni incluse; ante imposte.':'Profitti dello snapshot, commissioni incluse; ante imposte.',
      'Max drawdown dalle rilevazioni del bot, dall’avvio a t1.'];
    if(!b)note.push('Benchmark BTC e drawdown non disponibili.');
    else if(b.status==='legacy_partial'||b.history_complete===false)note.push('Confronto parziale: gli avvii potrebbero non essere allineati.');
    if(!b?.start_at)note.push('La data iniziale del confronto non è disponibile.');
    if(presentation.historical)note.push('Valori dello snapshot indicato; dati non attuali.');
    $('comparison-note').textContent=note.join(' ');
  }
  function render() {
    const p=snapshot.portfolio,m=snapshot.metrics,risk=m.risk;
    const presentation=snapshotPresentation(snapshot,{source,online:navigator.onLine,syncFailed:Boolean(fetchFailure)});
    const {offline,halted}=presentation,{stale,future,invalid}=presentation.timing;
    const isMom300 = snapshot.strategy === 'mom300';
    const stratBadge = isMom300 ? ' · mom300 pura' : '';
    $('source-label').textContent=(source==='demo'?'Demo locale':snapshot.mode==='live'?`Snapshot · trading live${stratBadge}`:`Snapshot · simulazione${stratBadge}`)+(halted?' · esecuzione bloccata':'');
    $('source-detail').textContent=source==='demo'?'Valori iniziali della specifica. Nessun collegamento al conto.':`${source==='import'?'Importato dal dispositivo':source==='cache'?'Ultimo snapshot salvato':'Snapshot del motore'}${snapshot.monitoring?.message?` · ${snapshot.monitoring.message}`:''}${stale?' · dati oltre 36 ore':''}${future?' · data futura rispetto al dispositivo':''}${invalid?' · data non verificabile':''}${offline?' · offline / sincronizzazione non disponibile':''}.`;
    $('source-dot').className=`status-dot ${source==='demo'||presentation.historical?'amber':'teal'}`;
    $('last-update').textContent=snapshot.generated_at?`Generato ${dateLabel(snapshot.generated_at,true)} · mercato ${dateLabel(snapshot.market_as_of,true)} (Roma)`:'Nessun dato di mercato aggiornato';
    $('pnl-label').textContent=presentation.pnlLabel;
    $('sandbox-fee-note').textContent=sandboxFeeNote();
    $('total-value').textContent=eur(p.total_value_eur);$('contributed').textContent=eur(p.contributed_eur);$('pnl').textContent=signed(p.pnl_eur);$('pnl').className=`kpi-number ${p.pnl_eur<0?'negative':'positive'}`;
    $('pnl-percent').textContent=`${p.pnl_pct>=0?'+':''}${num(p.pnl_pct)}%`;$('pnl-percent').className=`pill ${p.pnl_pct<0?'negative':''}`;
    $('cash').textContent=eur(p.cash_eur);
    renderComparison(presentation);
    const b = snapshot.benchmark;
    if (isMom300 && b) {
      const alphaSigned = (b.alpha_eur >= 0 ? '+' : '−') + eur(Math.abs(b.alpha_eur));
      const btcPnlSigned = (b.pnl_eur >= 0 ? '+' : '−') + eur(Math.abs(b.pnl_eur));
      $('cash-detail').innerHTML = `Max DD mom300: <strong>${Math.abs(b.portfolio_max_drawdown_pct).toFixed(2)}%</strong> · BTC: <strong>${Math.abs(b.benchmark_max_drawdown_pct).toFixed(2)}%</strong>`;
      const comparisonLabel=b.status==='legacy_partial'||b.history_complete===false?'Confronto BTC parziale':'Differenza vs BTC';
      $('capital-detail').textContent = `${comparisonLabel}: ${alphaSigned} · BTC passivo: ${eur(b.current_btc_value_eur)} (${btcPnlSigned})${b.start_at?` · dal ${dateLabel(b.start_at)}`:''}`;
    } else if (isMom300) {
      $('cash-detail').textContent = `Liquidità effettiva · target ${m.mom300?.signal === 1?'BTC':'EUR'}`;
      $('capital-detail').textContent=`${source==='demo'?'P&L della demo':snapshot.mode==='simulation'?'P&L realizzato simulato':'P&L realizzato dello snapshot'}: ${signed(p.realized_pnl_eur)} · ante imposte`;
    } else {
      $('cash-detail').textContent=`${eur(p.dca_remaining_eur,0)} rate · ${eur(p.reserve_remaining_eur,0)} riserva`;
      $('capital-detail').textContent=`${source==='demo'?'P&L della demo':snapshot.mode==='simulation'?'P&L realizzato simulato':'P&L realizzato dello snapshot'}: ${signed(p.realized_pnl_eur)} · ante imposte`;
    }
    $('fees-total').textContent=eur(p.fees_eur,4);
    if (isMom300 && m.mom300) {
      const mom = m.mom300;
      const isBull = mom.signal === 1;
      const retPct = mom.return != null ? (mom.return * 100).toFixed(2) : '0.00';
      $('risk-zone').textContent = presentation.historical ? (isBull ? 'TORO (storico)' : 'ORSO (storico)') : (isBull ? 'Target 100% BTC' : 'Target 100% EUR');
      if(snapshot.strategy_details?.awaiting_rebalance)$('risk-zone').textContent=presentation.historical?'Attesa lunedì · snapshot':'Nuovo segnale · attesa lunedì';
      $('risk-zone').className = `pill ${isBull&&!presentation.historical&&!snapshot.strategy_details?.awaiting_rebalance ? 'positive' : 'warning'}`;
      $('risk-score').textContent = `${mom.return >= 0 ? '+' : ''}${retPct}%`;
      $('risk-description').textContent = `${presentation.historical?'Segnale registrato nello snapshot. ':''}Momentum 300gg ${mom.return>0?'positivo':mom.return<0?'negativo':'nullo'} (${mom.return>=0?'+':''}${retPct}%). Target ${isBull?'BTC':'EUR'}; le posizioni effettive sono nel portafoglio.`;
      if(snapshot.strategy_details?.awaiting_rebalance)$('risk-description').textContent+=` Il target deliberato resta ${snapshot.strategy_details.last_decision_signal===1?'100% BTC':'100% EUR'} fino al prossimo controllo settimanale (${snapshot.strategy_details.next_rebalance_date}).`;
      $('gauge-fill').style.strokeDasharray = `${isBull ? 100 : 0} 100`;
      $('gauge-fill').style.stroke = isBull&&!presentation.historical&&!snapshot.strategy_details?.awaiting_rebalance ? '#48d5b2' : '#eab965';
    } else {
      const [label,tone,description]=zone(risk);$('risk-zone').textContent=presentation.historical?`${label} · snapshot`:label;$('risk-zone').className=`pill ${presentation.historical?'warning':tone}`;$('risk-score').textContent=risk??'—';$('risk-description').textContent=presentation.historical?'Indice rilevato nello snapshot. Segnale non attuale.':description;
      $('gauge-fill').style.strokeDasharray=`${risk??0} 100`;$('gauge-fill').style.stroke=presentation.historical?'#eab965':risk>=75?'#f18c99':risk>68||risk<30?'#eab965':'#48d5b2';
    }
    if (isMom300 && m.mom300) {
      $('rsi').textContent = eur(m.prices.BTC);
      $('wma').textContent = eur(m.mom300.close_t301);
      const retPct300 = (m.mom300.return * 100).toFixed(2);
      $('fng').textContent = `${m.mom300.return >= 0 ? '+' : ''}${retPct300}%`;
      const compLabels = document.querySelectorAll('.risk-components div span');
      if (compLabels.length >= 3) {
        compLabels[0].textContent = 'Prezzo attuale BTC';
        compLabels[1].textContent = 'Prezzo 300gg fa';
        compLabels[2].textContent = 'Ritorno 300gg';
      }
    } else {
      $('rsi').textContent=m.rsi==null?'—':num(m.rsi,1);$('wma').textContent=m.wma_ratio==null?'—':`${num(m.wma_ratio,2)}×`;$('fng').textContent=m.fng==null?'—':`${num(m.fng,0)} / 100`;
    }
    $('signal-title').textContent=isMom300?'Momentum a 300 giorni':'Indice di rischio';
    document.querySelector('.risk-card').classList.toggle('momentum',isMom300);
    $('signal-scale').hidden=isMom300;
    document.querySelectorAll('.gauge-axis').forEach(label=>{label.style.display=isMom300?'none':'';});
    const componentLabels=document.querySelectorAll('.risk-components div span');
    if(!isMom300&&componentLabels.length>=3) ['RSI · 14 settimane','Prezzo / media 200W','Fear & Greed'].forEach((label,i)=>{componentLabels[i].textContent=label;});
    const displayedAssets = isMom300 ? p.assets.filter(a => a.symbol === 'BTC') : p.assets;
    const badge = document.querySelector('.assets-card .subtle-badge');
    if (badge) badge.textContent = isMom300 ? '1 asset · BTC_EUR Spot' : '4 asset · EUR';
    const tableFoot = document.querySelector('.assets-card .table-foot');
    if (tableFoot) tableFoot.innerHTML=isMom300?'<span><i class="tiny-dot teal"></i> Banda sui pesi: 5% · minimo modellato: 5 €</span><span>BTC_EUR Spot</span>':'<span><i class="tiny-dot teal"></i> Rebalancing ALT: target +15% relativo</span><span>Portafoglio dello snapshot</span>';
    $('asset-rows').innerHTML=displayedAssets.map(a=>{
      const meta=META[a.symbol],excess=(a.weight-a.target_weight)*p.assets.reduce((v,x)=>v+x.value_eur,0);
      const rebalance=a.symbol!=='BTC'&&a.weight>a.max_weight&&excess>=15;
      let status=a.symbol==='BTC'?'Core · accumulo':a.trailing_stop_eur!=null?'Trailing attivo':rebalance?'Ribilancia su BTC':'In equilibrio';
      if(a.symbol!=='BTC'&&m.rel_30d[a.symbol]!=null&&m.rel_30d[a.symbol]<=-15&&risk<75)status='Scudo → BTC';
      if(isMom300) {
        const momSig = a.target_weight;
        status = `${presentation.historical?'Target storico: ':'Target: '}${momSig===1?'100% BTC':'100% EUR'}`;
      } else if(presentation.historical) {
        status=`Nello snapshot: ${status}`;
      }
      const note=isMom300
        ? `Peso BTC effettivo: ${num(a.weight*100,1)}% del patrimonio`
        : (a.symbol==='BTC'?'Nessuna vendita core':m.rel_30d[a.symbol]==null?'Forza relativa non disponibile':`${num(m.rel_30d[a.symbol],2)} pp vs BTC · 30g`);
      return `<tr style="--coin-color:${meta.color}"><td><div class="coin-cell"><span class="coin-avatar" aria-hidden="true">${meta.glyph}</span><div><div class="coin-name">${meta.name}<span class="coin-symbol">${a.symbol}</span></div><div class="coin-qty">${num(a.quantity,a.symbol==='BTC'||a.symbol==='ETH'?8:5)} ${a.symbol}</div></div></div></td><td>${a.quantity?eur(a.pmc_eur,a.symbol==='CRO'?4:2):'—'}<small>Prezzo ${a.price_eur?eur(a.price_eur,a.symbol==='CRO'?4:2):'—'}</small></td><td>${eur(a.value_eur)}<small>Base ${eur(a.cost_basis_eur)}</small></td><td class="${a.pnl_eur<0?'negative':'positive'}">${signed(a.pnl_eur)}<small>${a.cost_basis_eur?`${a.pnl_eur>=0?'+':''}${num(a.pnl_eur/a.cost_basis_eur*100)}%`:'—'}</small></td><td>${num(a.weight*100,1)}% <small>Target ${num(a.target_weight*100,1)}%${!isMom300&&a.symbol!=='BTC'?` · max ${num(a.max_weight*100,2)}%`:''}</small><span class="weight-track"><i style="width:${Math.min(100,a.weight*100)}%"></i></span></td><td><span class="strategy-badge ${rebalance?'warning':a.symbol==='BTC'?'neutral':''}">${status}</span><small>${note}</small></td><td>${a.trailing_stop_eur==null?'<span class="muted">Non attivo</span>':eur(a.trailing_stop_eur,a.symbol==='CRO'?4:2)}${a.high_water_eur==null?'':`<small>Massimo ${eur(a.high_water_eur,a.symbol==='CRO'?4:2)}</small>`}</td></tr>`;
    }).join('');
    const allocations=isMom300
      ? [
          {label:'Bitcoin (BTC)',value:p.assets[0].value_eur,color:META.BTC.color},
          {label:'Liquidità EUR',value:p.cash_eur,color:'#48d5b2'}
        ]
      : [...p.assets.map(a=>({label:a.symbol,value:a.value_eur,color:META[a.symbol].color})),{label:'Liquidità EUR',value:p.cash_eur,color:'#48d5b2'}];
    let cursor=0;const segments=allocations.map(a=>{const start=cursor;cursor+=p.total_value_eur?a.value/p.total_value_eur*100:0;return `${a.color} ${start}% ${cursor}%`;});
    $('allocation-ring').style.background=p.total_value_eur?`conic-gradient(${segments.join(',')})`:'#27364b';$('allocation-total').textContent=eur(p.total_value_eur,0);
    $('allocation-legend').innerHTML=allocations.map(a=>`<div><span><i style="background:${a.color}"></i>${a.label}</span><strong>${num(p.total_value_eur?a.value/p.total_value_eur*100:0,1)}%</strong></div>`).join('');
    $('allocation-ring').setAttribute('aria-label',`Allocazione del patrimonio: ${allocations.map(a=>`${a.label} ${eur(a.value)}`).join(', ')}.`);
    const warnings=[...snapshot.warnings];if(b?.note)warnings.push(b.note);if(presentation.pnlContext)warnings.push(presentation.pnlContext);if(stale)warnings.push('Snapshot non aggiornato: prezzi e segnali potrebbero essere cambiati.');if(future)warnings.push('Una data dello snapshot è oltre 5 minuti nel futuro rispetto all’orologio di questo dispositivo. I segnali sono mostrati come dati non attuali.');if(invalid&&source!=='demo')warnings.push('Le date dello snapshot o l’orologio del dispositivo non sono verificabili. I segnali sono mostrati come dati non attuali.');if(source==='cache')warnings.push('Viene mostrata una copia locale salvata. Il bot cloud non è collegato in tempo reale.');
    $('warnings').hidden=!warnings.length;$('warnings').innerHTML=warnings.map(w=>`<p>${escapeHTML(w)}</p>`).join('');
    const researchTitle = $('research-title');
    if (researchTitle) {
      researchTitle.textContent=isMom300?'mom300 · monitoraggio operativo':'Ricerca: vantaggio non dimostrato';
      const noticeP = researchTitle.parentElement?.querySelector('p');
      if (noticeP) {
        noticeP.textContent=isMom300?'Snapshot del motore BTC/EUR con momentum a 300 giorni. Il segnale indica un target, distinto dalle posizioni eseguite. I risultati qui mostrati non sono previsioni e non dimostrano un vantaggio futuro su BTC.':'Un P&L positivo o un’esecuzione riuscita non dimostrano un vantaggio su BTC.';
      }
    }
    renderEngines(presentation);renderHistory();renderOperations();renderRoutes();
    if (isMom300) {
      $('cash-plan-title').textContent='Liquidità del portafoglio';$('cash-plan-eyebrow').textContent='BTC / EUR';
      $('installment-count').textContent = 'mom300';
      $('installment-steps').innerHTML = '<span class="installment-step done" title="Strategia mom300 attiva"></span>';
      $('installment-steps').setAttribute('aria-label', 'Strategia mom300 attiva');
      $('dca-cash').textContent = eur(0);
      $('reserve-cash').textContent = eur(0);
      $('other-cash').textContent = eur(p.cash_eur);
    } else {
      $('cash-plan-title').textContent='Un piano, quattro rate.';$('cash-plan-eyebrow').textContent='SMART DCA';
      $('installment-count').textContent=`${p.installments_completed} / 4`;$('installment-steps').innerHTML=Array.from({length:4},(_,i)=>`<span class="installment-step ${i<p.installments_completed?'done':''}" title="Rata ${i+1}: ${i<p.installments_completed?'eseguita':'disponibile'}"></span>`).join('');
      $('installment-steps').setAttribute('aria-label',`${p.installments_completed} rate completate su 4`);
      $('dca-cash').textContent=eur(p.dca_remaining_eur);$('reserve-cash').textContent=eur(p.reserve_remaining_eur);$('other-cash').textContent=eur(Math.max(0,p.cash_eur-p.dca_remaining_eur-p.reserve_remaining_eur));
    }
    $('dca-row').hidden=isMom300;$('reserve-row').hidden=isMom300;
    $('other-cash-label').textContent=isMom300?'Saldo EUR effettivo':'Liquidità da altre operazioni';
    $('footer-mode').textContent=`${source==='demo'?'Demo locale':snapshot.mode==='live'?'Trading live · snapshot in sola lettura':'Simulazione · snapshot in sola lettura'} · nessuna chiave API nel browser`;
  }
  function renderEngines(presentation) {
    const engines=engineCards(snapshot,presentation);
    $('engine-cards').innerHTML=engines.map((e,i)=>`<article class="engine-card"><div class="engine-top"><span class="engine-icon" aria-hidden="true">${e.icon}</span><span class="engine-number">0${i+1}</span></div><h3>${e.name}</h3><p>${e.description}</p><div class="engine-status ${e.tone}"><i></i>${e.status}</div></article>`).join('');
  }
  function renderHistory() {
    const history=snapshot.history,p=snapshot.portfolio,isPnl=$('chart-view').value==='pnl';
    const isMom300 = snapshot.strategy === 'mom300';
    $('chart-value').textContent=isPnl?signed(p.pnl_eur):eur(p.total_value_eur);
    $('chart-note').textContent=history.length?`${history.length} rilevazioni · ${dateLabel(history[0].time)} – ${dateLabel(history[history.length-1].time)}`:'In attesa del primo storico';
    const series=historySeries(snapshot,isPnl);
    $('chart-series-label').textContent=isPnl?(isMom300?'P&L mom300':'P&L'):isMom300?'mom300 pura':'Patrimonio';
    $('benchmark-legend').hidden=!series.hasBenchmark;
    $('capital-legend').hidden=isPnl;
    $('history-empty').textContent=history.length>1?'Valori delle esecuzioni del motore. Le operazioni includono le commissioni contabilizzate.':history.length===1?'Prima rilevazione disponibile. La curva si popolerà con le prossime esecuzioni.':'Lo storico si popola con le esecuzioni del motore. Nessuna previsione di rendimento.';
    if(lineChart){lineChart.destroy();lineChart=null;}
    const holder=$('history-chart');holder.innerHTML='';
    if(!history.length){holder.textContent='Nessuno storico disponibile nello snapshot.';return;}
    const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',history.length?`Storico ${isPnl?'P&L':'patrimonio'}`:'Nessuno storico disponibile.');holder.append(canvas);
    if(typeof global.Chart!=='function'){holder.textContent='Grafico non disponibile. Lo snapshot JSON contiene lo storico completo.';return;}
    const points=history;
    const values=series.values;
    const benchValues=series.benchmark;
    const dataset={
      label:isPnl?(isMom300?'P&L mom300':'P&L'):isMom300?'mom300 pura':'Patrimonio',
      data:values,
      borderColor:'#48d5b2',
      backgroundColor:'rgba(72,213,178,.07)',
      fill:!isMom300,
      borderWidth:2,
      tension:0,
      pointRadius:points.length<2?4:0,
      pointHoverRadius:4
    };
    const datasets=[dataset];
    if(series.hasBenchmark){
      datasets.push({
        label:isPnl?'P&L Buy & Hold BTC':'Buy & Hold BTC (Passivo)',
        data:benchValues,
        borderColor:'#e7b160',
        backgroundColor:'rgba(231,177,96,.04)',
        fill:false,
        borderWidth:2,
        borderDash:[4,4],
        tension:0,
        pointRadius:points.length<2?4:0,
        pointHoverRadius:4
      });
    }
    if(!isPnl){
      datasets.push({
        label:'Capitale iniziale',
        data:points.map(h=>h.contributed_eur),
        borderColor:'#6c80a9',
        borderDash:[5,5],
        borderWidth:1,
        pointRadius:0,
        fill:false
      });
    }
    const reduced=global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    lineChart=new global.Chart(canvas,{
      type:'line',
      data:{labels:points.map(h=>Date.parse(h.time)),datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:reduced?false:{duration:250},
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:'#1b2c43',
            titleColor:'#c3d6e8',
            bodyColor:'#afc3dc',
            padding:10,
            callbacks:{title:items=>items.length?dateLabel(items[0].parsed.x,true):'',label:ctx=>`${ctx.dataset.label}: ${eur(ctx.parsed.y)}`}
          }
        },
        scales:{
          x:{type:'linear',grid:{display:false},border:{display:false},ticks:{color:'#6e839f',font:{size:9},maxTicksLimit:6,maxRotation:0,callback:value=>dateLabel(value)}},
          y:{position:'right',border:{display:false},grid:{color:'#243248',drawTicks:false},ticks:{color:'#7186a2',font:{size:9},padding:10,maxTicksLimit:4,callback:value=>eur(value,0)},grace:'8%'}
        }
      }
    });
  }
  function renderOperations() {
    const actions=snapshot.actions.slice(-6).reverse();
    if(!actions.length){$('operation-list').innerHTML='<div class="empty-state"><span class="empty-symbol" aria-hidden="true">≡</span>Nessuna operazione nello snapshot.<br><span class="fine-print">Le esecuzioni del motore appariranno qui.</span></div>';return;}
    $('operation-list').innerHTML=actions.map(a=>`<div class="operation"><span class="operation-icon" aria-hidden="true">${a.side==='BUY'?'↙':'↗'}</span><div class="operation-info"><div class="operation-title">${a.side==='BUY'?'Acquisto':a.side==='SELL'?'Vendita':escapeHTML(a.side)} · ${escapeHTML(a.instrument)}</div><div class="operation-reason">${escapeHTML(a.reason)} · ${escapeHTML(a.status)}</div></div><div class="operation-value">${a.quantity!=null?num(a.quantity,8):a.notional!=null?num(a.notional,8):'—'}<small>${dateLabel(a.time,true)}</small>${a.fee_eur!=null?`<small>Fee ${eur(a.fee_eur,4)}</small>`:''}</div></div>`).join('');
  }
  function renderRoutes(){
    const routes=snapshot.exit_routes||[],panel=$('route-status');
    panel.hidden=!routes.length;if(!routes.length){panel.textContent='';return;}
    const labels={planned:'Prima conversione in attesa',btc_received:'Conversione BTC → EUR in attesa',completed:'Conversione completata',completed_with_dust:'Completata con residui',requires_review:'Verifica richiesta · esecuzione bloccata'};
    const btc=snapshot.portfolio.assets.find(a=>a.symbol==='BTC');
    const reserved=btc?.route_reserved_quantity??routes.reduce((sum,r)=>sum+r.btc_reserved,0),dust=btc?.route_dust_quantity??routes.reduce((sum,r)=>sum+r.btc_dust,0);
    panel.innerHTML=`<p><strong>Uscite CRO → BTC → EUR</strong></p>${routes.slice(-4).reverse().map(r=>`<p>${labels[r.status]} · ${num(r.source_quantity,8)} CRO · ${eur(r.eur_received)} ricevuti${r.btc_reserved>0?` · ${num(r.btc_reserved,8)} BTC vincolati alla seconda conversione`:''}${r.btc_dust>0?` · residuo tracciato ${num(r.btc_dust,8)} BTC`:''}${r.source_dust_quantity>0?` · residuo non convertito ${num(r.source_dust_quantity,8)} CRO`:''}</p>`).join('')}<p class="fine-print">BTC intermedi vincolati: ${num(reserved,8)} BTC · residui: ${num(dust,8)} BTC. Importi già inclusi nel patrimonio, separati dal BTC core. Il residuo resta tracciato in BTC.</p>`;
  }
  async function refresh({manual=false}={}) {
    if(busy)return;busy=true;$('refresh').disabled=true;feedback('');
    if(manual){sourceVersion++;importSelectionVersion++;}
    lastRefreshAttempt=Date.now();
    const requestSourceVersion=sourceVersion;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(`./data/dashboard.json?t=${Date.now()}`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(response.status===404?'Nessuno snapshot del motore pubblicato.':`Sincronizzazione non riuscita (HTTP ${response.status}).`);
      const next=validateSnapshot(await response.json());
      if(next.mode!=='simulation'||next.strategy!=='mom300')throw new Error('Il monitor pubblico accetta dal server soltanto simulazioni mom300.');
      if(requestSourceVersion!==sourceVersion)return;
      snapshot=next;source='server';fetchFailure='';storageWrite(STORAGE,{snapshot,source:'server'});
      feedback('Snapshot caricato. Le date della fonte sono indicate nel riepilogo.');
    }catch(error){if(requestSourceVersion===sourceVersion){fetchFailure=error.name==='AbortError'?'Tempo di attesa scaduto.':error.message;feedback(`${fetchFailure} ${source==='demo'?'Resta disponibile la demo locale; puoi importare un export JSON.':'Sono conservati i dati già caricati.'}`,source!=='demo');}}
    finally{clearTimeout(timer);busy=false;$('refresh').disabled=false;render();}
  }
  function renderSandbox() {
    const value=sandbox.assets.reduce((sum,a)=>sum+a.value_eur,0)+sandbox.cash_eur;
    $('sandbox-totals').innerHTML=[['Patrimonio simulato',eur(value)],['Capitale versato',eur(sandbox.contributed_eur)],['DCA / Riserva',`${eur(sandbox.dca_remaining_eur,0)} / ${eur(sandbox.reserve_remaining_eur,0)}`],['Rate / Commissioni',`${sandbox.installments_completed} di 4 / ${eur(sandbox.fees_eur,3)}`]].map(([l,v])=>`<div>${l}<strong>${v}</strong></div>`).join('');
    $('cost-inputs').innerHTML=SYMBOLS.map(s=>`<label>Costo storico ${s} (€)<input id="cost-${s}" type="number" min="0" step="0.01" value="${sandbox.assets.find(a=>a.symbol===s).cost_basis_eur.toFixed(2)}" ${sandbox.months.length?'disabled':''}></label>`).join('');
    $('sandbox-costs').disabled=Boolean(sandbox.months.length);
  }
  $('refresh').addEventListener('click',()=>refresh({manual:true}));
  $('import-button').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    const selection=++importSelectionVersion;sourceVersion++;
    try{if(file.size>5*1024*1024)throw new Error('Il file supera il limite di 5 MB.');const next=validateSnapshot(JSON.parse(await file.text()));if(selection!==importSelectionVersion)return;sourceVersion++;snapshot=next;source='import';fetchFailure='';storageWrite(STORAGE,{snapshot,source:'import'});render();feedback('Snapshot importato in sola lettura. Le simulazioni locali restano separate.');}catch(error){if(selection===importSelectionVersion)feedback(`Importazione non riuscita: ${error.message}`,true);}finally{if(selection===importSelectionVersion)event.target.value='';}
  });
  $('export').addEventListener('click',()=>{
    if(source==='demo'){feedback('La demo iniziale non è uno snapshot del motore. Genera o importa un export per esportare i dati.');return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`quant-5-${snapshot.mode}-${snapshot.generated_at.slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('chart-view').addEventListener('change',renderHistory);
  $('sandbox-open').addEventListener('click',()=>{renderSandbox();$('sandbox-dialog').showModal();});
  $('sandbox-month').value=new Date().toISOString().slice(0,7);
  $('sandbox-buy').addEventListener('click',()=>{
    try{if(!$('sandbox-month').checkValidity()||!$('sandbox-risk').checkValidity()||!$('sandbox-relative').checkValidity())throw new Error('Compila mese, rischio e forza relativa con valori validi.');const result=simulateDca(sandbox,$('sandbox-month').value,Number($('sandbox-risk').value),Number($('sandbox-relative').value));sandbox=result.state;storageWrite(SANDBOX_STORAGE,sandbox);renderSandbox();$('sandbox-feedback').textContent=result.message;$('sandbox-feedback').classList.remove('error');}catch(error){$('sandbox-feedback').textContent=error.message;$('sandbox-feedback').classList.add('error');}
  });
  $('sandbox-costs').addEventListener('click',()=>{
    try{if(sandbox.months.length)throw new Error('Ripristina la simulazione prima di modificare i costi.');const next=clone(sandbox);for(const s of SYMBOLS){const input=$(`cost-${s}`);if(input.value.trim()==='')throw new Error('Compila tutti i costi.');const value=finite(Number(input.value),`costo ${s}`,0,1e9);const a=next.assets.find(a=>a.symbol===s);a.cost_basis_eur=value;a.pmc_eur=a.quantity?value/a.quantity:0;a.pnl_eur=a.value_eur-value;}next.contributed_eur=500+next.assets.reduce((sum,a)=>sum+a.cost_basis_eur,0);sandbox=next;storageWrite(SANDBOX_STORAGE,sandbox);renderSandbox();$('sandbox-feedback').textContent='Costi della sola simulazione aggiornati.';$('sandbox-feedback').classList.remove('error');}catch(error){$('sandbox-feedback').textContent=error.message;$('sandbox-feedback').classList.add('error');}
  });
  $('sandbox-reset').addEventListener('click',()=>{sandbox=newSandbox();storageWrite(SANDBOX_STORAGE,sandbox);renderSandbox();$('sandbox-feedback').textContent='Simulazione ripristinata ai valori iniziali.';$('sandbox-feedback').classList.remove('error');});
  global.addEventListener('online',()=>{render();if(source!=='import')refresh();});global.addEventListener('offline',()=>{render();});
  const renderWhenVisible=()=>{if(document.visibilityState!=='hidden'){render();if(source!=='import'&&navigator.onLine&&Date.now()-lastRefreshAttempt>=5*60*1000)refresh();}};
  document.addEventListener('visibilitychange',renderWhenVisible);
  global.addEventListener('focus',renderWhenVisible);
  global.setInterval(renderWhenVisible,60000);
  global.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});
  $('install').addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;$('install').hidden=true;});
  global.addEventListener('appinstalled',()=>{$('install').hidden=true;installPrompt=null;});
  if('serviceWorker' in navigator && ['https:','http:'].includes(location.protocol)){
    let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;location.reload();}});
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{/* Read-only app works without offline installation. */});
  }
  render();if(source!=='import')refresh();
})(typeof window!=='undefined'?window:globalThis);
