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

async function loadStandings(){
  const res = await fetch('/api/standings?type=overall');
  const data = await res.json();
  const rows = data.rows || [];
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
    tr.innerHTML = `<td>${i+1}</td><td>${r.team}</td><td>${r.composite}</td>`;
    tbody.appendChild(tr);
  });
}
// initial load
switchTab('standings'); loadStandings();
