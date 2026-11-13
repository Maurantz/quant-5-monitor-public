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
    const synthetic=current.metrics?.source==='offline-demo'||Object.values(current.metrics?.sources||{}).includes('offline-demo');
    const offline=source==='cache'||!online||Boolean(syncFailed);
    const halted=current.execution_status==='halted';
    const monitoringProblem=current.monitoring?.status && current.monitoring.status!=='ok';
    return {timing,offline,halted,synthetic,historical:!demo&&(synthetic||offline||halted||monitoringProblem||timing.invalid||timing.stale||timing.future),
      pnlLabel:demo?'P&L demo':synthetic?'P&L demo offline':current.mode==='simulation'?'P&L simulato':'P&L dello snapshot',
      pnlContext:demo?'Valori ipotetici della demo locale.':synthetic?'Dati dimostrativi offline: non sono rilevazioni reali del mercato.':current.mode==='simulation'?'Risultato di operazioni simulate, ante imposte. Non dimostra un vantaggio della strategia.':''};
  }
  function sandboxFeeNote() {
    const fee=FEE.toLocaleString('it-IT',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2});
    return `Esempi ipotetici ai prezzi iniziali. Commissione simulata ${fee} per acquisto. Le modifiche restano su questo dispositivo e non alterano gli snapshot del motore.`;
  }
  const hasEnsemble = current => Boolean(current.metrics?.mom300?.ensemble);
  const momentumName = current => hasEnsemble(current) ? 'Ensemble (270·300·365)' : 'MOM300';
  function circuitBreakerDescription(current) {
    const flat=current.portfolio.assets.every(asset=>asset.quantity===0);
    return flat ? 'Lo snapshot registra la posizione in EUR.' : 'La posizione BTC è ancora presente: verificare le operazioni e la riconciliazione.';
  }
  function setHidden(id,hidden) {
    const element=$(id);
    if(!element)return;
    // SVG <g> has no HTMLElement.hidden reflection. Set the real attribute so
    // the shared [hidden] rule works when switching imported model families.
    if(hidden)element.setAttribute('hidden','');
    else element.removeAttribute?.('hidden');
    element.hidden=hidden;
  }
  function engineCards(current, presentation) {
    if (current.strategy === 'mom300') {
      const mom = current.metrics.mom300 || {};
      const isBull = mom.signal === 1;
      const details=current.strategy_details,waiting=Boolean(details?.awaiting_rebalance);
      const isCb = Boolean(current.circuit_breaker_triggered);
      const ens = current.metrics.mom300?.ensemble;
      const votes = ens?.votes ?? (mom.votes ?? (isBull ? 3 : 0));
      const name = momentumName(current);
      const desc = ens ? 'Segnali di 270, 300 e 365 giorni. Con almeno 2 segnali positivi il target è 100% BTC, altrimenti 100% EUR; le posizioni effettive sono nel portafoglio.' : 'Confronto tra chiusure distanti 300 giorni: target 100% BTC se il rendimento è positivo, altrimenti 100% EUR.';
      const statusText = isCb ?
        `STOP CRASH ATTIVO: Crollo 7d del ${(current.circuit_breaker_triggered.drop_7d * 100).toFixed(1)}%` :
        `${ens ? `Ensemble: ${votes}/3 voti` : 'MOM300'} · ${isBull ? 'Target 100% BTC' : 'Target 100% EUR'}`;
      const engines = [
        {name, icon:'⚡', description:desc, status:statusText, tone:isCb ? 'critical' : (isBull ? 'enabled' : 'warning')},
        {name:'Rotazione Settimanale',icon:'⇄',description:'Controllo allocazione ogni lunedì con soglia di tolleranza 5% per evitare turnover inutile.',status:waiting?`Nuovo segnale: attesa del prossimo lunedì (${details.next_rebalance_date}). Target deliberato: ${details.last_decision_signal===1?'100% BTC':'100% EUR'}.`:'Controllo periodico ogni lunedì',tone:waiting?'warning':'enabled'},
        ...(ens||mom.drop_7d!==undefined||isCb ? [{name:'Crash Circuit Breaker',icon:'🛡️',description:'A ogni avvio controlla il calo sulle ultime chiusure a 7 giorni. Alla soglia di -15% richiede l’uscita in EUR; ritardi e ordini pendenti possono lasciare BTC esposti.',status:isCb ? `ATTIVATO · ${circuitBreakerDescription(current)}` : 'Controllo a ogni avvio · soglia -15%',tone:isCb ? 'critical' : 'enabled'}] : []),
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
    if(m.source!==undefined)metrics.source=text(m.source);
    if(m.sources&&typeof m.sources==='object'&&!Array.isArray(m.sources)){
      metrics.sources={};
      for(const key of ['daily','weekly','prices','fng','venue','instrument','instrument_name'])if(typeof m.sources[key]==='string')metrics.sources[key]=text(m.sources[key]);
    }
    if(raw.mode==='live'&&(metrics.source==='offline-demo'||Object.values(metrics.sources||{}).includes('offline-demo')))throw new Error('Una demo offline non può essere uno snapshot live.');
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
      if (m.mom300.votes !== undefined) {
        metrics.mom300.votes = finite(m.mom300.votes, 'mom300.votes', 0, 3);
        if(!Number.isInteger(metrics.mom300.votes))throw new Error('Voti ensemble non interi.');
      }
      if (m.mom300.drop_7d !== undefined) metrics.mom300.drop_7d = finite(m.mom300.drop_7d, 'mom300.drop_7d', -1);
      if (m.mom300.ensemble !== undefined) {
        const ens = m.mom300.ensemble;
        if(!ens||typeof ens!=='object'||Array.isArray(ens)||ens.rule!=='majority_2_of_3'||![0,1].includes(ens.signal)||!Number.isInteger(ens.votes))throw new Error('Regola, segnale o voti ensemble non validi.');
        metrics.mom300.ensemble = {
          signal: finite(ens.signal, 'ensemble.signal', 0, 1),
          votes: finite(ens.votes, 'ensemble.votes', 0, 3),
          rule: text(ens.rule || 'majority_2_of_3'),
        };
        for (const k of ['mom270', 'mom300', 'mom365']) {
          if (ens[k] && typeof ens[k] === 'object'&&!Array.isArray(ens[k])) {
            const days=Number(k.slice(3));
            if(![0,1].includes(ens[k].signal))throw new Error(`Segnale ${k} non binario.`);
            metrics.mom300.ensemble[k] = {
              return: finite(ens[k].return, `${k}.return`),
              signal: finite(ens[k].signal, `${k}.signal`, 0, 1),
              days: finite(ens[k].days, `${k}.days`, days, days),
              t_date: calendarDate(ens[k].t_date, `${k}.t_date`),
              close: finite(ens[k].close, `${k}.close`, Number.MIN_VALUE),
            };
            const component=metrics.mom300.ensemble[k];
            const expectedReturn=metrics.mom300.close_t1/component.close-1;
            if(Date.parse(`${metrics.mom300.t1_date}T00:00:00Z`)-Date.parse(`${component.t_date}T00:00:00Z`)!==days*86400000
                ||Math.abs(expectedReturn-component.return)>1e-8||component.signal!==(expectedReturn>0?1:0))throw new Error(`Date, rendimento e segnale ${k} incoerenti.`);
            if (ens[k].pnl_eur !== undefined) metrics.mom300.ensemble[k].pnl_eur = finite(ens[k].pnl_eur, `${k}.pnl_eur`);
            if (ens[k].pnl_pct !== undefined) metrics.mom300.ensemble[k].pnl_pct = finite(ens[k].pnl_pct, `${k}.pnl_pct`);
            if (ens[k].max_drawdown_pct !== undefined) metrics.mom300.ensemble[k].max_drawdown_pct = finite(ens[k].max_drawdown_pct, `${k}.max_drawdown_pct`, -100, 0);
            if (ens[k].value_eur !== undefined) metrics.mom300.ensemble[k].value_eur = finite(ens[k].value_eur, `${k}.value_eur`, 0);
            if (ens[k].initial_capital_eur !== undefined) component.initial_capital_eur=finite(ens[k].initial_capital_eur,`${k}.initial_capital_eur`,Number.MIN_VALUE);
            if (ens[k].start_at!==undefined) {
              component.start_at=ens[k].start_at===null?null:timestamp(ens[k].start_at,`${k}.start_at`);
              if(component.start_at&&Date.parse(component.start_at)>Date.parse(generatedAt))throw new Error(`Avvio ${k} successivo allo snapshot.`);
            }
            if(ens[k].status!==undefined){
              if(!['tracking','legacy_partial'].includes(ens[k].status))throw new Error(`Copertura ${k} non valida.`);
              component.status=ens[k].status;
            }
            if(ens[k].history_complete!==undefined){
              if(typeof ens[k].history_complete!=='boolean')throw new Error(`Storico ${k} non valido.`);
              component.history_complete=ens[k].history_complete;
            }
            if(ens[k].note!==undefined)component.note=text(ens[k].note);
          }else throw new Error(`Componente ensemble ${k} mancante.`);
        }
        const normalized=metrics.mom300.ensemble;
        const votes=['mom270','mom300','mom365'].reduce((n,k)=>n+normalized[k].signal,0);
        if(normalized.votes!==votes||normalized.signal!==(votes>=2?1:0)||(metrics.mom300.votes!==undefined&&metrics.mom300.votes!==votes))throw new Error('Maggioranza ensemble incoerente con i tre segnali.');
        if(Math.abs(normalized.mom300.return-metrics.mom300.return)>1e-8||normalized.mom300.close!==metrics.mom300.close_t301||normalized.mom300.t_date!==metrics.mom300.t301_date)throw new Error('Componente MOM300 incoerente con i prezzi del segnale.');
      }
      const mom=metrics.mom300,expected=(mom.close_t1-mom.close_t301)/mom.close_t301;
      const expectedSignal = mom.ensemble ? mom.ensemble.signal : (expected > 0 ? 1 : 0);
      if (Date.parse(`${mom.t1_date}T00:00:00Z`)-Date.parse(`${mom.t301_date}T00:00:00Z`)!==300*86400000 || Math.abs(expected-mom.return)>1e-8 || mom.signal !== expectedSignal) throw new Error('Date, rendimento e segnale mom300 incoerenti.');
      if(mom.t1_date>=generatedAt.slice(0,10))throw new Error('Il segnale usa una candela non ancora chiusa alla generazione dello snapshot.');
      const expectedDay=new Date(Date.parse(`${generatedAt.slice(0,10)}T00:00:00Z`)-86400000).toISOString().slice(0,10);
      if(mom.t1_date!==expectedDay)throw new Error('Manca la chiusura dell’esatto giorno UTC precedente alla rilevazione.');
      mom.target_label=mom.signal===1?'100% BTC':'100% Cash EUR';
    }
    let strategyDetails;
    if (isMom300&&raw.strategy_details!==undefined) {
      const d=raw.strategy_details;
      if (!d||typeof d!=='object'||Array.isArray(d)) throw new Error('Dettagli della strategia non validi.');
      strategyDetails={};
      ['name','asset','rebalance_cadence','description','performance_note'].forEach(k=>{if(d[k]!==undefined)strategyDetails[k]=text(d[k]);});
      if(d.current_model!==undefined){
        if(!['ensemble_270_300_365_cb7d15','mom300_pure'].includes(d.current_model))throw new Error('Identità del modello non supportata.');
        strategyDetails.current_model=d.current_model;
      }
      if(d.performance_scope!==undefined){
        if(!['mixed_or_unverified','current_model_only'].includes(d.performance_scope))throw new Error('Origine dello storico del modello non valida.');
        strategyDetails.performance_scope=d.performance_scope;
      }
      if(d.model_recorded_at!==undefined){
        strategyDetails.model_recorded_at=timestamp(d.model_recorded_at,'prima verifica del modello');
        if(Date.parse(strategyDetails.model_recorded_at)>Date.parse(generatedAt))throw new Error('Registrazione modello successiva allo snapshot.');
      }
      if(d.lookback_days!==undefined)strategyDetails.lookback_days=finite(d.lookback_days,'lookback strategia',300,300);
      if(d.band_pct!==undefined)strategyDetails.band_pct=finite(d.band_pct,'banda strategia',5,5);
      if (['last_decision_at','last_decision_signal','next_rebalance_date','awaiting_rebalance'].some(k=>d[k]!==undefined)) {
        if(![0,1].includes(d.last_decision_signal)||typeof d.awaiting_rebalance!=='boolean')throw new Error('Decisione settimanale non valida.');
        const last=d.last_decision_at==null?null:timestamp(d.last_decision_at,'ultima decisione');
        const next=calendarDate(d.next_rebalance_date,'prossimo controllo');
        if(new Date(`${next}T00:00:00Z`).getUTCDay()!==1||Date.parse(`${next}T00:00:00Z`)<Date.parse(`${generatedAt.slice(0,10)}T00:00:00Z`)||(last&&Date.parse(last)>Date.parse(generatedAt)))throw new Error('Calendario della decisione settimanale incoerente.');
        const day=new Date(`${generatedAt.slice(0,10)}T00:00:00Z`);
        let days=(8-day.getUTCDay())%7;
        if(days===0&&last?.slice(0,10)===generatedAt.slice(0,10))days=7;
        const expectedNext=new Date(day.getTime()+days*86400000).toISOString().slice(0,10);
        if(next!==expectedNext)throw new Error('La data non corrisponde al prossimo controllo settimanale.');
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
    if(raw.actions!==undefined&&!Array.isArray(raw.actions))throw new Error('Registro delle operazioni non valido.');
    const actions=(raw.actions||[]).slice(-200).map(a => ({time:timestamp(a.time,'operazione'),reason:text(a.reason),instrument:text(a.instrument),side:text(a.side),quantity:nullable(a.quantity,'quantità operazione',0),notional:nullable(a.notional,'controvalore operazione',0),status:text(a.status),fee_eur:nullable(a.fee_eur,'commissione',0)}));
    if(actions.some(a=>Date.parse(a.time)>Date.parse(generatedAt)))throw new Error('Il registro contiene operazioni successive allo snapshot.');
    if(raw.history!==undefined&&!Array.isArray(raw.history))throw new Error('Storico dello snapshot non valido.');
    const history=(raw.history||[]).slice(-2000).map(h=>({
      time:timestamp(h.time,'storico'),
      value_eur:finite(h.value_eur,'valore storico',0),
      contributed_eur:finite(h.contributed_eur,'capitale storico',0),
      benchmark_btc_val:nullable(h.benchmark_btc_val,'valore storico BTC passivo',0),
      benchmark_btc_pnl:nullable(h.benchmark_btc_pnl,'P&L storico BTC passivo'),
      drawdown_pct:nullable(h.drawdown_pct,'drawdown storico',-100,0),
      benchmark_drawdown_pct:nullable(h.benchmark_drawdown_pct,'drawdown storico BTC passivo',-100,0),
      mom270_val:nullable(h.mom270_val,'valore storico MOM270',0),
      mom270_pnl:nullable(h.mom270_pnl,'P&L storico MOM270'),
      mom300_val:nullable(h.mom300_val,'valore storico MOM300',0),
      mom300_pnl:nullable(h.mom300_pnl,'P&L storico MOM300'),
      mom365_val:nullable(h.mom365_val,'valore storico MOM365',0),
      mom365_pnl:nullable(h.mom365_pnl,'P&L storico MOM365')
    }));
    history.forEach((h,i)=>{
      if(Date.parse(h.time)>Date.parse(generatedAt)||(i>0&&Date.parse(h.time)<=Date.parse(history[i-1].time)))throw new Error('Storico duplicato, fuori ordine o successivo allo snapshot.');
      if ((h.benchmark_btc_val===null)!==(h.benchmark_btc_pnl===null) || (h.benchmark_btc_val!==null && Math.abs(h.benchmark_btc_val-h.contributed_eur-h.benchmark_btc_pnl)>.11)) throw new Error('Benchmark storico incoerente.');
    });
    const lastPoint=history.at(-1),currentPoint=lastPoint?.time===generatedAt?lastPoint:null;
    if(currentPoint&&(Math.abs(currentPoint.value_eur-portfolio.total_value_eur)>.1||Math.abs(currentPoint.contributed_eur-portfolio.contributed_eur)>.1))throw new Error('Ultimo punto del grafico incoerente con il patrimonio corrente.');
    for(const key of ['mom270','mom300','mom365']){
      const model=metrics.mom300?.ensemble?.[key];
      const performanceFields=['value_eur','pnl_eur','pnl_pct','max_drawdown_pct'];
      const provided=performanceFields.filter(field=>model?.[field]!==undefined).length;
      if(provided&&provided!==performanceFields.length)throw new Error(`Risultati ${key} incompleti.`);
      const capital=model?.initial_capital_eur??portfolio.contributed_eur;
      if(provided&&(Math.abs(model.value_eur-capital-model.pnl_eur)>.11
          ||Math.abs((capital?model.pnl_eur/capital*100:0)-model.pnl_pct)>.06))throw new Error(`Valori e capitale ${key} incoerenti.`);
      let peak=capital,worst=0;
      for(const point of history){
        const value=point[`${key}_val`],pnl=point[`${key}_pnl`];
        if((value===null)!==(pnl===null)||(value!==null&&Math.abs(value-(model?.initial_capital_eur??point.contributed_eur)-pnl)>.11))throw new Error(`Storico ${key} incoerente.`);
        if(value===null)continue;
        if(model?.status==='tracking'&&model.history_complete===true&&model.start_at&&Date.parse(point.time)<Date.parse(model.start_at))throw new Error(`Storico ${key} precedente al proprio avvio.`);
        peak=Math.max(peak,value);worst=Math.min(worst,peak?(value/peak-1)*100:0);
      }
      if(provided){
        peak=Math.max(peak,model.value_eur);worst=Math.min(worst,peak?(model.value_eur/peak-1)*100:0);
        if(model.max_drawdown_pct>worst+.02)throw new Error(`Drawdown ${key} inferiore al calo osservato.`);
        if(currentPoint?.[`${key}_val`]!=null&&Math.abs(currentPoint[`${key}_val`]-model.value_eur)>.11)throw new Error(`Grafico e riquadro ${key} incoerenti.`);
      }
    }
    if(raw.exit_routes!==undefined&&!Array.isArray(raw.exit_routes))throw new Error('Elenco delle conversioni CRO non valido.');
    const exitRoutes=(raw.exit_routes||[]).slice(-200).map(route=>{
      if(!route||typeof route.id!=='string'||!route.id||route.source_symbol!=='CRO'||!['planned','btc_received','completed','completed_with_dust','requires_review'].includes(route.status))throw new Error('Stato della conversione CRO non valido.');
      const normalized={id:text(route.id),status:route.status,reason:text(route.reason),source_symbol:'CRO',created_at:timestamp(route.created_at,'conversione CRO')};
      ['source_quantity','btc_received','btc_reserved','btc_dust','btc_reserved_cost_basis_eur','eur_received'].forEach(k=>{normalized[k]=finite(route[k],`conversione CRO.${k}`,0);});
      if(route.source_dust_quantity!==undefined)normalized.source_dust_quantity=finite(route.source_dust_quantity,'residuo CRO',0);
      return normalized;
    });
    const normalizedSnapshot = {schema_version:1,mode:raw.mode,strategy:raw.strategy||'legacy',execution_status:executionStatus,generated_at:generatedAt,market_as_of:marketAsOf,metrics,portfolio,actions,history,exit_routes:exitRoutes,warnings:(Array.isArray(raw.warnings)?raw.warnings:[]).filter(x=>typeof x==='string').slice(0,30).map(text)};
    if (raw.circuit_breaker_triggered!==undefined&&raw.circuit_breaker_triggered!==null) {
      const cb = raw.circuit_breaker_triggered;
      if(!isMom300||!cb||typeof cb!=='object'||Array.isArray(cb))throw new Error('Stato circuit breaker non valido.');
      const cbTime = cb.triggered_at ?? cb.time;
      normalizedSnapshot.circuit_breaker_triggered = {
        drop_7d: finite(cb.drop_7d, 'circuit_breaker.drop_7d', -1, -.15),
        threshold: cb.threshold === undefined ? -0.15 : finite(cb.threshold, 'circuit_breaker.threshold', -.15, -.15),
        triggered_at: timestamp(cbTime, 'circuit_breaker.triggered_at'),
      };
      if(Date.parse(normalizedSnapshot.circuit_breaker_triggered.triggered_at)>Date.parse(generatedAt))throw new Error('Circuit breaker successivo allo snapshot.');
      if (cb.reason !== undefined) normalizedSnapshot.circuit_breaker_triggered.reason = text(cb.reason);
    }
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
      if(benchmark.start_at&&Date.parse(benchmark.start_at)>Date.parse(generatedAt))throw new Error('L’inizio del confronto è successivo all’ultima rilevazione.');
      if (b.fee_rate!==undefined) benchmark.fee_rate=finite(b.fee_rate,'commissione benchmark',0,1);
      if (b.history_complete!==undefined) {
        if(typeof b.history_complete!=='boolean') throw new Error('Copertura dello storico benchmark non valida.');
        benchmark.history_complete=b.history_complete;
      }
      if(isMom300&&benchmark.status==='tracking'&&benchmark.history_complete===true){
        if(benchmark.start_at&&history.some(h=>Date.parse(h.time)<Date.parse(benchmark.start_at)))throw new Error('Lo storico completo precede l’avvio del confronto.');
        if(history.some(h=>Math.abs(h.contributed_eur-portfolio.contributed_eur)>.1))throw new Error('Il capitale del confronto MOM300 varia nello storico: riconciliazione richiesta.');
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
    const history=current.history||[];
    const isMom=current.strategy==='mom300';
    const hasBenchmark=isMom&&Boolean(current.benchmark)&&history.some(h=>h.benchmark_btc_val!==null&&h.benchmark_btc_val!==undefined);
    const extractModelSeries=key=>{
      if(!isMom||!hasEnsemble(current))return null;
      const values=history.map(h=>{
        const valKey=`${key}_val`,pnlKey=`${key}_pnl`;
        if(h[valKey]!=null)return isPnl?(h[pnlKey]??h[valKey]-h.contributed_eur):h[valKey];
        return null;
      });
      return values.some(value=>value!==null)?values:null;
    };
    return {
      hasBenchmark,
      values:history.map(h=>isPnl?h.value_eur-h.contributed_eur:h.value_eur),
      benchmark:history.map(h=>hasBenchmark?(isPnl?h.benchmark_btc_pnl:h.benchmark_btc_val):null),
      mom270:extractModelSeries('mom270'),
      mom300:extractModelSeries('mom300'),
      mom365:extractModelSeries('mom365')
    };
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
  const hiddenSeries = new Set();
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
    $('comparison-mode').textContent=presentation.synthetic?'Demo offline':snapshot.mode==='simulation'?'Simulazione':'Snapshot live';
    for(const id of ['comparison-profit-strategy','comparison-drawdown-strategy'])if($(id))$(id).textContent=momentumName(snapshot);
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
    const ens=snapshot.metrics?.mom300?.ensemble,mom=snapshot.metrics?.mom300;
    if($('comparison-models-grid'))$('comparison-models-grid').hidden=!ens;
    const models=[
      {key:'mom270',obj:ens?.mom270},
      {key:'mom300',obj:ens?.mom300},
      {key:'mom365',obj:ens?.mom365}
    ];
    models.forEach(({key,obj})=>{
      const sig=obj?.signal;
      const isTargetBtc=sig===1;
      const targetEl=$(`comparison-${key}-target`);
      if(targetEl){
        targetEl.textContent=obj?(isTargetBtc?'Segnale BTC':'Segnale EUR'):'Non disponibile';
        targetEl.className=`pill ${isTargetBtc?'positive':'neutral'}`;
      }
      const mPnl=obj?.pnl_eur,mPct=obj?.pnl_pct,mDd=obj?.max_drawdown_pct;
      const profEl=$(`comparison-${key}-profit`);
      if(profEl){
        profEl.textContent=mPnl===undefined?'—':signed(mPnl);
        profEl.className=`model-val ${mPnl===undefined?'':mPnl<0?'negative':'positive'}`;
      }
      const retEl=$(`comparison-${key}-return`);
      if(retEl){
        retEl.textContent=mPct===undefined?'—':percentage(mPct);
        retEl.className=`model-ret ${mPct===undefined?'':mPct<0?'negative':'positive'}`;
      }
      const ddEl=$(`comparison-${key}-drawdown`);
      if(ddEl){
        ddEl.textContent=mDd===undefined?'—':`${Math.abs(mDd).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
        ddEl.className=`model-val ${mDd<0?'negative':''}`;
      }
      const periodEl=$(`comparison-${key}-period`);
      if(periodEl)periodEl.textContent=obj?.start_at?`Dal ${dateLabel(obj.start_at,true)}${obj.status==='legacy_partial'||obj.history_complete===false?' · origine parziale':''}`:'Avvio individuale non documentato';
    });
    const note=[presentation.synthetic?'Risultati dimostrativi offline; commissioni simulate incluse.':snapshot.mode==='simulation'?'Profitti simulati, commissioni incluse; ante imposte.':'Profitti dello snapshot, commissioni incluse; ante imposte.',
      'Max drawdown dalle rilevazioni del bot, dall’avvio a t1.'];
    if(!b)note.push('Benchmark BTC e drawdown non disponibili.');
    else if(b.status==='legacy_partial'||b.history_complete===false)note.push('Confronto parziale: gli avvii potrebbero non essere allineati.');
    if(!b?.start_at)note.push('La data iniziale del confronto non è disponibile.');
    if(ens){
      note.push('I tre portafogli individuali sono simulazioni indipendenti, ciascuna dal proprio avvio. Le etichette indicano il segnale giornaliero, non la posizione effettiva.');
      if(snapshot.strategy_details?.performance_scope!=='current_model_only')note.push('Lo storico principale include regole precedenti o di origine non verificata: non è attribuibile interamente all’ensemble attuale.');
    }
    if(presentation.historical)note.push('Valori dello snapshot indicato; dati non attuali.');
    $('comparison-note').textContent=note.join(' ');
  }
  function render() {
    const p=snapshot.portfolio,m=snapshot.metrics,risk=m.risk;
    const presentation=snapshotPresentation(snapshot,{source,online:navigator.onLine,syncFailed:Boolean(fetchFailure)});
    const {offline,halted}=presentation,{stale,future,invalid}=presentation.timing;
    const isMom300 = snapshot.strategy === 'mom300';
    const isEnsemble=isMom300&&hasEnsemble(snapshot);
    const stratBadge = isMom300 ? ` · ${momentumName(snapshot)}` : '';
    $('source-label').textContent=(source==='demo'?'Demo locale':presentation.synthetic?`Demo offline${stratBadge}`:snapshot.mode==='live'?`Snapshot · trading live${stratBadge}`:`Snapshot · simulazione${stratBadge}`)+(halted?' · esecuzione bloccata':'');
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
      $('cash-detail').innerHTML = `<span class="kpi-dd">Max DD ${isEnsemble?'Ensemble':'MOM300'}: <strong>${Math.abs(b.portfolio_max_drawdown_pct).toFixed(2)}%</strong></span><span class="kpi-dd-div">·</span><span class="kpi-dd">BTC: <strong>${Math.abs(b.benchmark_max_drawdown_pct).toFixed(2)}%</strong></span>`;
      const comparisonLabel=b.status==='legacy_partial'||b.history_complete===false?'Confronto BTC parziale':'Differenza vs BTC';
      $('capital-detail').textContent = `${comparisonLabel}: ${alphaSigned} · BTC passivo: ${eur(b.current_btc_value_eur)} (${btcPnlSigned})${b.start_at?` · dal ${dateLabel(b.start_at)}`:''}`;
    } else if (isMom300) {
      $('cash-detail').textContent = `${snapshot.mode==='simulation'?'Liquidità simulata':'Liquidità del registro'} · target ${m.mom300?.signal === 1?'BTC':'EUR'}`;
      $('capital-detail').textContent=`${source==='demo'?'P&L della demo':snapshot.mode==='simulation'?'P&L realizzato simulato':'P&L realizzato dello snapshot'}: ${signed(p.realized_pnl_eur)} · ante imposte`;
    } else {
      $('cash-detail').textContent=`${eur(p.dca_remaining_eur,0)} rate · ${eur(p.reserve_remaining_eur,0)} riserva`;
      $('capital-detail').textContent=`${source==='demo'?'P&L della demo':snapshot.mode==='simulation'?'P&L realizzato simulato':'P&L realizzato dello snapshot'}: ${signed(p.realized_pnl_eur)} · ante imposte`;
    }
    $('fees-total').textContent=eur(p.fees_eur,4);
    if (isMom300 && m.mom300) {
      const mom = m.mom300;
      const isBull = mom.signal === 1;
      const isCb = Boolean(snapshot.circuit_breaker_triggered);
      const ens = mom.ensemble;
      const votes = ens?.votes ?? (mom.votes ?? (isBull ? 3 : 0));

      $('signal-title').textContent = isMom300 ? 'Ensemble Momentum (270 · 300 · 365)' : 'Indice di rischio';

      setHidden('gauge-ensemble',false);
      setHidden('gauge-legacy',true);
      if ($('consensus-pill')) $('consensus-pill').hidden = false;

      const sig270 = ens?.mom270?.signal ?? (isBull ? 1 : 0);
      const sig300 = ens?.mom300?.signal ?? (isBull ? 1 : 0);
      const sig365 = ens?.mom365?.signal ?? (isBull ? 1 : 0);

      const setCls = (id, cls) => {
        const el = typeof id === 'string' ? $(id) : id;
        if (!el) return;
        try { el.setAttribute('class', cls); } catch {}
        try { if (typeof el.className === 'string') el.className = cls; } catch {}
      };

      if (isCb) {
        $('risk-zone').textContent = 'Circuit breaker · target EUR';
        $('risk-zone').className = 'pill negative';
        $('risk-score').textContent = 'STOP CRASH';
        if ($('consensus-pill')) {
          $('consensus-pill').textContent = 'STOP CRASH ATTIVO';
          $('consensus-pill').className = 'consensus-badge negative';
        }
        $('risk-description').textContent = `${presentation.historical?'Stato registrato nello snapshot. ':''}Crash Circuit Breaker attivato: calo sulle chiusure a 7 giorni di ${(snapshot.circuit_breaker_triggered.drop_7d * 100).toFixed(1)}%. ${circuitBreakerDescription(snapshot)}`;
        $('gauge-fill').style.strokeDasharray = '0 100';
        $('gauge-fill').style.stroke = '#f18c99';
        ['gauge-arc-270','gauge-arc-300','gauge-arc-365'].forEach(id=>setCls(id, 'gauge-segment-fill crash'));
        ['led-270','led-300','led-365','led-cb'].forEach(id=>setCls(id, 'led-dot crash'));
      } else {
        $('risk-zone').textContent = presentation.historical ? (isBull ? 'TORO (storico)' : 'ORSO (storico)') : (isBull ? 'Target 100% BTC' : 'Target 100% EUR');
        if (snapshot.strategy_details?.awaiting_rebalance) $('risk-zone').textContent = presentation.historical ? 'Attesa lunedì · snapshot' : 'Nuovo segnale · attesa lunedì';
        $('risk-zone').className = `pill ${isBull && !presentation.historical && !snapshot.strategy_details?.awaiting_rebalance ? 'positive' : 'warning'}`;
        $('risk-score').textContent = `${votes}/3 Voti Toro`;
        if ($('consensus-pill')) {
          if (votes === 3) {
            $('consensus-pill').textContent = 'CONSENSO UNANIME TORO';
            $('consensus-pill').className = 'consensus-badge positive';
          } else if (votes === 2) {
            $('consensus-pill').textContent = 'MAGGIORANZA TORO (2/3)';
            $('consensus-pill').className = 'consensus-badge positive';
          } else if (votes === 1) {
            $('consensus-pill').textContent = 'DIVERGENZA ORSO (1/3)';
            $('consensus-pill').className = 'consensus-badge warning';
          } else {
            $('consensus-pill').textContent = 'CONSENSO UNANIME ORSO';
            $('consensus-pill').className = 'consensus-badge warning';
          }
        }
        const detailText = ens ? `Ensemble a maggioranza: ${votes} segnali Toro e ${3-votes} Orso. Target giornaliero ${isBull ? '100% BTC' : '100% EUR'}; le posizioni effettive sono nel portafoglio.` : `Momentum a 300 giorni ${(mom.return*100).toFixed(1)}%. Target giornaliero ${isBull?'100% BTC':'100% EUR'}; le posizioni effettive sono nel portafoglio.`;
        $('risk-description').textContent = `${presentation.historical ? 'Segnale registrato nello snapshot. ' : ''}${detailText}`;
        if (snapshot.strategy_details?.awaiting_rebalance) {
          $('risk-description').textContent += ` Il target deliberato resta ${snapshot.strategy_details.last_decision_signal === 1 ? '100% BTC' : '100% EUR'} fino al prossimo controllo settimanale (${snapshot.strategy_details.next_rebalance_date}).`;
        }
        const gaugePct = Math.round((votes / 3) * 100);
        $('gauge-fill').style.strokeDasharray = `${gaugePct} 100`;
        $('gauge-fill').style.stroke = isBull && !presentation.historical && !snapshot.strategy_details?.awaiting_rebalance ? '#48d5b2' : '#eab965';
        setCls('gauge-arc-270', `gauge-segment-fill ${sig270 === 1 ? 'bull' : 'bear'}`);
        setCls('gauge-arc-300', `gauge-segment-fill ${sig300 === 1 ? 'bull' : 'bear'}`);
        setCls('gauge-arc-365', `gauge-segment-fill ${sig365 === 1 ? 'bull' : 'bear'}`);
        setCls('led-270', `led-dot ${sig270 === 1 ? 'bull' : 'bear'}`);
        setCls('led-300', `led-dot ${sig300 === 1 ? 'bull' : 'bear'}`);
        setCls('led-365', `led-dot ${sig365 === 1 ? 'bull' : 'bear'}`);
        setCls('led-cb', 'led-dot bull');
      }

      if ($('label-mom270')) $('label-mom270').textContent = 'MOM 270gg';
      if ($('label-mom300')) $('label-mom300').textContent = 'MOM 300gg';
      if ($('label-mom365')) $('label-mom365').textContent = 'MOM 365gg';
      ['led-270', 'led-300', 'led-365'].forEach(id => { if ($(id)) $(id).hidden = false; });
      const r270 = ens?.mom270?.return ?? mom.return ?? 0;
      const r300 = ens?.mom300?.return ?? mom.return ?? 0;
      const r365 = ens?.mom365?.return ?? mom.return ?? 0;
      $('rsi').textContent = `${r270 >= 0 ? '+' : ''}${(r270 * 100).toFixed(1)}%`;
      $('wma').textContent = `${r300 >= 0 ? '+' : ''}${(r300 * 100).toFixed(1)}%`;
      $('fng').textContent = `${r365 >= 0 ? '+' : ''}${(r365 * 100).toFixed(1)}%`;
      const cbRow = $('cb-row');
      if (cbRow) {
        cbRow.hidden = !isMom300;
        const cbStatus = $('cb-status');
        if (cbStatus) {
          if (isCb) {
            cbStatus.textContent = `INNESCATO (${(snapshot.circuit_breaker_triggered.drop_7d * 100).toFixed(1)}%)`;
            cbStatus.style.color = 'var(--red)';
          } else {
            const dropVal = ens?.drop_7d ?? mom.drop_7d;
            const drop7 = dropVal != null ? ` · 7d: ${(dropVal * 100).toFixed(1)}%` : '';
            cbStatus.textContent = `Attivo (soglia -15%${drop7})`;
            cbStatus.style.color = '';
          }
        }
      }
    } else {
      setHidden('gauge-ensemble',true);
      setHidden('gauge-legacy',false);
      if ($('consensus-pill')) $('consensus-pill').hidden = true;
      if ($('label-mom270')) $('label-mom270').textContent = 'RSI · 14 settimane';
      if ($('label-mom300')) $('label-mom300').textContent = 'Prezzo / media 200W';
      if ($('label-mom365')) $('label-mom365').textContent = 'Fear & Greed';
      ['led-270', 'led-300', 'led-365'].forEach(id => { if ($(id)) $(id).hidden = true; });
      const [label,tone,description]=zone(risk);$('risk-zone').textContent=presentation.historical?`${label} · snapshot`:label;$('risk-zone').className=`pill ${presentation.historical?'warning':tone}`;$('risk-score').textContent=risk??'—';$('risk-description').textContent=presentation.historical?'Indice rilevato nello snapshot. Segnale non attuale.':description;
      $('gauge-fill').style.strokeDasharray=`${risk??0} 100`;$('gauge-fill').style.stroke=presentation.historical?'#eab965':risk>=75?'#f18c99':risk>68||risk<30?'#eab965':'#48d5b2';
      $('rsi').textContent = m.rsi == null ? '—' : num(m.rsi, 1);
      $('wma').textContent = m.wma_ratio == null ? '—' : `${num(m.wma_ratio, 2)}x`;
      $('fng').textContent = m.fng == null ? '—' : num(m.fng, 0);
      const cbRow = $('cb-row');
      if (cbRow) cbRow.hidden = true;
    }
    if(isMom300&&!isEnsemble){
      $('risk-score').textContent=snapshot.circuit_breaker_triggered?'STOP CRASH':m.mom300.signal===1?'TORO':'ORSO';
      if($('consensus-pill'))$('consensus-pill').hidden=true;
      setHidden('gauge-ensemble',true);
      setHidden('gauge-legacy',false);
      $('gauge-fill').style.strokeDasharray=m.mom300.signal===1?'100 100':'0 100';
      $('label-mom300').textContent='Momentum · 300 giorni';
      $('wma').textContent=`${m.mom300.return>=0?'+':''}${(m.mom300.return*100).toFixed(1)}%`;
      for(const id of ['chip-mom270','chip-mom365'])if($(id))$(id).hidden=true;
      if($('cb-row'))$('cb-row').hidden=m.mom300.drop_7d===undefined&&!snapshot.circuit_breaker_triggered;
    }else for(const id of ['chip-mom270','chip-mom365'])if($(id))$(id).hidden=false;
    $('signal-title').textContent = isEnsemble ? 'Ensemble Momentum (270 · 300 · 365)' : isMom300?'Momentum · 300 giorni':'Indice di rischio';
    document.querySelector('.risk-card').classList.toggle('momentum',isMom300);
    if ($('signal-scale')) {
      $('signal-scale').hidden = isMom300;
      $('signal-scale').style.display = isMom300 ? 'none' : '';
      $('signal-scale').textContent = isMom300 ? '' : '/ 100';
    }
    document.querySelectorAll('.gauge-axis').forEach(label=>{label.style.display=isMom300?'none':'';});
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
      researchTitle.textContent=isMom300?`${momentumName(snapshot)} · vantaggio da validare`:'Ricerca: vantaggio non dimostrato';
      const noticeP = researchTitle.parentElement?.querySelector('p');
      if (noticeP) {
        noticeP.textContent=isMom300?`${momentumName(snapshot)} su BTC/EUR. Il segnale giornaliero, il target deliberato e le posizioni effettive possono differire. I risultati osservati e i controlli del software non dimostrano redditività futura o un vantaggio robusto su BTC.`:'Un P&L positivo o un’esecuzione riuscita non dimostrano un vantaggio su BTC.';
      }
    }
    renderEngines(presentation);renderHistory();renderOperations();renderRoutes();
    if (isMom300) {
      $('cash-plan-title').textContent='Liquidità del portafoglio';$('cash-plan-eyebrow').textContent='BTC / EUR';
      $('installment-count').textContent = isEnsemble?'Ensemble':'MOM300';
      $('installment-steps').innerHTML = '<span class="installment-step done" title="Monitoraggio del modello"></span>';
      $('installment-steps').setAttribute('aria-label', `Monitoraggio ${momentumName(snapshot)}`);
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
    $('sandbox-open').textContent=isMom300?'Apri demo Smart DCA separata':'Esplora il simulatore Smart DCA';
    $('sandbox-context').textContent=isMom300?'Demo Smart DCA multi-asset didattica separata. Non modifica i risultati del bot.':'Il simulatore usa un portafoglio separato e non invia ordini.';
    $('other-cash-label').textContent=isMom300?(snapshot.mode==='simulation'?'Saldo EUR simulato':'Saldo EUR del registro'):'Liquidità da altre operazioni';
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
    const seriesLabel=isMom300?(hasEnsemble(snapshot)?'Ensemble Maggioranza':'MOM300'):'Patrimonio';
    $('chart-series-label').textContent=isPnl?(isMom300?`P&L ${hasEnsemble(snapshot)?'Ensemble':'MOM300'}`:'P&L'):seriesLabel;
    $('benchmark-legend').hidden=!series.hasBenchmark;
    for(const key of ['mom270','mom300','mom365'])if($(`${key}-legend`))$(`${key}-legend`).hidden=series[key]===null;
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
    const datasets=[];
    const pushDs=(key,cfg,btnId)=>{
      const idx=datasets.length;
      const isOff=hiddenSeries.has(key);
      datasets.push({...cfg,hidden:isOff});
      if(btnId&&$(btnId)){
        $(btnId).setAttribute('data-ds',String(idx));
        $(btnId).setAttribute('data-series',key);
        $(btnId).classList.toggle('off',isOff);
        $(btnId).classList.toggle('active',!isOff);
      }
    };
    pushDs('ensemble',{
      label:isPnl?(isMom300?`P&L ${hasEnsemble(snapshot)?'Ensemble':'MOM300'}`:'P&L'):seriesLabel,
      data:values,
      borderColor:'#48d5b2',
      backgroundColor:'rgba(72,213,178,.07)',
      fill:!isMom300,
      borderWidth:2.5,
      tension:0,
      pointRadius:points.length<2?4:0,
      pointHoverRadius:4
    },'ensemble-legend');
    if(series.hasBenchmark){
      pushDs('benchmark',{
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
      },'benchmark-legend');
    }
    if(isMom300&&series.mom270){
      pushDs('mom270',{
        label:isPnl?'P&L MOM 270gg':'MOM 270gg',
        data:series.mom270,
        borderColor:'#38bdf8',
        backgroundColor:'transparent',
        fill:false,
        borderWidth:1.5,
        tension:0,
        pointRadius:points.length<2?3:0,
        pointHoverRadius:3
      },'mom270-legend');
    }
    if(isMom300&&series.mom300){
      pushDs('mom300',{
        label:isPnl?'P&L MOM 300gg':'MOM 300gg',
        data:series.mom300,
        borderColor:'#a78bfa',
        backgroundColor:'transparent',
        fill:false,
        borderWidth:1.5,
        tension:0,
        pointRadius:points.length<2?3:0,
        pointHoverRadius:3
      },'mom300-legend');
    }
    if(isMom300&&series.mom365){
      pushDs('mom365',{
        label:isPnl?'P&L MOM 365gg':'MOM 365gg',
        data:series.mom365,
        borderColor:'#fb923c',
        backgroundColor:'transparent',
        fill:false,
        borderWidth:1.5,
        tension:0,
        pointRadius:points.length<2?3:0,
        pointHoverRadius:3
      },'mom365-legend');
    }
    if(!isPnl){
      pushDs('capital',{
        label:'Capitale iniziale',
        data:points.map(h=>h.contributed_eur),
        borderColor:'#6c80a9',
        borderDash:[5,5],
        borderWidth:1,
        pointRadius:0,
        fill:false
      },null);
    }
    lineChart=new global.Chart(canvas,{
      type:'line',
      data:{labels:points.map(h=>Date.parse(h.time)),datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:false,
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
      if(snapshotPresentation(next).synthetic)throw new Error('Il feed pubblico non può sostituire le rilevazioni con una demo offline.');
      if(requestSourceVersion!==sourceVersion)return;
      if((source==='server'||source==='cache')&&!snapshotTiming(snapshot).future&&!snapshotTiming(snapshot).invalid){
        const olderData=Date.parse(next.generated_at)<Date.parse(snapshot.generated_at);
        const olderAttempt=snapshot.monitoring?.last_attempt_at&&next.monitoring?.last_attempt_at&&Date.parse(next.monitoring.last_attempt_at)<Date.parse(snapshot.monitoring.last_attempt_at);
        if(olderData||olderAttempt)throw new Error('Risposta precedente ai dati già caricati: conservata l’ultima rilevazione disponibile.');
      }
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
  const legendEl = $('chart-legend');
  if (legendEl) {
    legendEl.addEventListener('click', event => {
      const btn = event.target?.closest?.('.legend-btn');
      if (!btn || !lineChart) return;
      const dsIdx = Number(btn.getAttribute('data-ds'));
      const key = btn.getAttribute('data-series');
      if (Number.isFinite(dsIdx) && lineChart.data?.datasets?.[dsIdx]) {
        const isVis = typeof lineChart.isDatasetVisible === 'function' ? lineChart.isDatasetVisible(dsIdx) : !hiddenSeries.has(key);
        if (key) {
          if (isVis) hiddenSeries.add(key);
          else hiddenSeries.delete(key);
        }
        if (typeof lineChart.setDatasetVisibility === 'function') {
          lineChart.setDatasetVisibility(dsIdx, !isVis);
        }
        if (typeof lineChart.update === 'function') {
          lineChart.update();
        }
        btn.classList.toggle('off', isVis);
        btn.classList.toggle('active', !isVis);
      }
    });
  }
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
