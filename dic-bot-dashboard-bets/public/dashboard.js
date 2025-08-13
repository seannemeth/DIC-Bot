function qs(sel){return document.querySelector(sel)}
function qsa(sel){return Array.from(document.querySelectorAll(sel))}
function fmtDate(s){const d=new Date(s); return d.toLocaleString()}

async function loadStandings() {
  const res = await fetch('/api/standings?type=overall'); const {rows} = await res.json();
  const tbody = qs('#standings tbody'); tbody.innerHTML='';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.team}</td><td>${r.w}-${r.l}${r.t?'-'+r.t:''}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.diff}</td>`;
    tbody.appendChild(tr);
  });
}

let powerChart;
async function loadPower() {
  const res = await fetch('/api/standings?type=power'); const {rows} = await res.json();
  const tbody = qs('#power tbody'); tbody.innerHTML='';
  const labels = [], data = [];
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.team}</td><td>${r.composite}</td><td>${r.elo.toFixed(0)}</td><td>${r.sos.toFixed(0)}</td><td>${r.form}</td>`;
    tbody.appendChild(tr);
    labels.push(r.team); data.push(r.composite);
  });
  const ctx = qs('#powerChart').getContext('2d');
  if (powerChart) powerChart.destroy();
  powerChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Power Rank (0–100)', data }] },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
  });
}

async function loadRecent() {
  const res = await fetch('/api/games/recent?limit=50'); const rows = await res.json();
  const tbody = qs('#recent tbody'); tbody.innerHTML='';
  rows.forEach(g=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(g.playedAt)}</td><td>${g.homeTeam} vs ${g.awayTeam}</td><td><strong>${g.homePts}</strong>–${g.awayPts}</td>`;
    tbody.appendChild(tr);
  });
}

function switchTab(id) {
  qsa('nav button').forEach(b => b.classList.remove('active'));
  qsa('.section').forEach(s => s.classList.remove('visible'));
  qs(`#tab-${id}`).classList.add('active');
  qs(`#section-${id}`).classList.add('visible');
}

qs('#tab-overall').addEventListener('click', ()=>{ switchTab('overall'); loadStandings(); });
qs('#tab-power').addEventListener('click', ()=>{ switchTab('power'); loadPower(); });
qs('#tab-recent').addEventListener('click', ()=>{ switchTab('recent'); loadRecent(); });

// initial
loadStandings();

async function loadLines() {
  const season = Number(qs('#lines-season').value || 1);
  const week = Number(qs('#lines-week').value || 1);
  const res = await fetch(`/api/lines?season=${season}&week=${week}`);
  const lines = await res.json();
  const tbody = qs('#lines tbody'); tbody.innerHTML='';
  lines.forEach(L => {
    const tr = document.createElement('tr');
    const cutoff = L.cutoff ? new Date(L.cutoff).toLocaleString() : '-';
    tr.innerHTML = `<td><b>${L.homeTeam}</b> vs ${L.awayTeam}</td>
      <td>${L.spread ?? '-'}</td><td>${L.total ?? '-'}</td>
      <td>${L.homeML ?? '-'}</td><td>${L.awayML ?? '-'}</td>
      <td>${cutoff}</td>
      <td><button data-home="${L.homeTeam}" data-away="${L.awayTeam}" data-season="${L.season}" data-week="${L.week}" class="pick">Pick</button></td>`;
    tbody.appendChild(tr);
  });
  qsa('button.pick').forEach(btn => btn.addEventListener('click', () => {
    const market = qs('#bet-market').value;
    const side = qs('#bet-side').value;
    const amt = Number(qs('#bet-amount').value || 100);
    const cmd = `/bet market:${market} home:${btn.dataset.home} away:${btn.dataset.away} season:${btn.dataset.season} week:${btn.dataset.week} side:${side} amount:${amt}`;
    qs('#bet-command').textContent = cmd;
  }));
}

async function loadWallets() {
  const res = await fetch('/api/wallets');
  const rows = await res.json();
  const tbody = qs('#wallets tbody'); tbody.innerHTML='';
  rows.forEach((w,i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${w.team}</td><td>${w.balance}</td>`;
    tbody.appendChild(tr);
  });
}

qs('#tab-betting').addEventListener('click', ()=>{ switchTab('betting'); loadLines(); loadWallets(); });
qs('#load-lines').addEventListener('click', ()=> loadLines());
qs('#copy-bet').addEventListener('click', async ()=>{
  const txt = qs('#bet-command').textContent;
  try { await navigator.clipboard.writeText(txt); } catch {}
});
