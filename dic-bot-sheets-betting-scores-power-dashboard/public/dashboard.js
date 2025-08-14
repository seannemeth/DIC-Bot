function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function switchTab(name){
  qsa('.section').forEach(s => s.classList.add('hidden'));
  qs('#section-'+name).classList.remove('hidden');
  qsa('nav button').forEach(b => b.classList.remove('active'));
  qs('#tab-'+name).classList.add('active');
}

qs('#tab-standings').addEventListener('click', ()=>{ switchTab('standings'); loadStandings(); });
qs('#tab-power').addEventListener('click', ()=>{ switchTab('power'); loadPower(); });
qs('#tab-recent').addEventListener('click', ()=>{ switchTab('recent'); loadRecent(); });

async function loadStandings(){
  const res = await fetch('/api/standings');
  const rows = await res.json();
  const tbody = qs('#standings tbody'); tbody.innerHTML = '';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.team}</td><td>${r.w}-${r.l}${r.t?'-'+r.t:''}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.diff}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadPower(){
  const res = await fetch('/api/power');
  const rows = await res.json();
  const tbody = qs('#power tbody'); tbody.innerHTML = '';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.team}</td><td>${r.composite}</td><td>${Math.round(r.elo)}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadRecent(){
  const res = await fetch('/api/games/recent?limit=50');
  const rows = await res.json();
  const tbody = qs('#recent tbody'); tbody.innerHTML = '';
  rows.forEach((g)=>{
    const dt = new Date(g.playedAt);
    const matchup = `${g.homeTeam} vs ${g.awayTeam}`;
    const final = g.homePts!=null && g.awayPts!=null ? `${g.homePts}-${g.awayPts}` : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dt.toLocaleString()}</td><td>${matchup}</td><td>${final}</td>`;
    tbody.appendChild(tr);
  });
}

// initial
switchTab('standings'); loadStandings();
