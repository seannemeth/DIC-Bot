import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const LIST = ["ACC","Big Ten","Big 12","Pac 12","SEC"];
export const command = {
  data: new SlashCommandBuilder().setName("confstandings").setDescription("Show conference standings").addStringOption(o=>o.setName("conference").setDescription("ACC | Big Ten | Big 12 | Pac 12 | SEC").setRequired(false)),
  async execute(interaction:any){
    const conf = interaction.options.getString("conference") || "";
    if (conf && !LIST.includes(conf)){ await interaction.reply({ content:"Conference must be one of: ACC, Big Ten, Big 12, Pac 12, SEC.", ephemeral:true }); return; }
    const teams = await prisma.coach.findMany({ where: conf ? { conference: conf } : { conference: { not: null } } });
    const ids = new Set(teams.map(t=>t.id));
    const games = await prisma.game.findMany({ where:{ status:"confirmed", OR:[{homeCoachId:{ in:Array.from(ids)}},{awayCoachId:{ in:Array.from(ids)}}] } });
    type Rec = { id:number, team:string, conf?:string|null, w:number,l:number,t:number,pf:number,pa:number,diff:number };
    const table: Rec[] = teams.map(t=>({ id:t.id, team:t.team||t.handle, conf:t.conference, w:0,l:0,t:0,pf:0,pa:0,diff:0 }));
    const lookup = new Map<number,Rec>(table.map(r=>[r.id,r]));
    for (const g of games){
      if (g.homePts==null || g.awayPts==null) continue;
      const h = lookup.get(g.homeCoachId); const a = lookup.get(g.awayCoachId);
      if (h){ h.pf += g.homePts; h.pa += g.awayPts; h.diff += (g.homePts-g.awayPts); }
      if (a){ a.pf += g.awayPts; a.pa += g.homePts; a.diff += (g.awayPts-g.homePts); }
      if (h && a){ if (g.homePts>g.awayPts){ h.w++; a.l++; } else if (g.homePts<g.awayPts){ a.w++; h.l++; } else { h.t++; a.t++; } }
    }
    function rank(rows:Rec[]){ return rows.sort((x,y)=>{ const wx=x.w+x.l+x.t?(x.w+0.5*x.t)/(x.w+x.l+x.t):0; const wy=y.w+y.l+y.t?(y.w+0.5*y.t)/(y.w+y.l+y.t):0; if(wy!==wx)return wy-wx; if(y.diff!==x.diff)return y.diff-x.diff; return (y.pf-y.pa)-(x.pf-x.pa); }); }
    if (conf){
      const rows = rank(table);
      const lines = rows.map((r,i)=> `**${i+1}. ${r.team}**  ${r.w}-${r.l}${r.t?'-'+r.t:''}  (Diff ${r.diff})`);
      await interaction.reply({ embeds:[ new EmbedBuilder().setTitle(`${conf} Standings`).setDescription(lines.join("\n")||"No teams").setColor(0x1abc9c) ] });
      return;
    }
    const by = new Map<string, Rec[]>(); for (const r of table){ const key=r.conf||"Unassigned"; if(!by.has(key)) by.set(key, []); by.get(key)!.push(r); }
    const wanted = LIST.filter(c=>by.has(c)).concat(Array.from(by.keys()).filter(k=>!LIST.includes(k)));
    const embeds = wanted.map(cname=>{ const rows=rank(by.get(cname)!); const lines=rows.map((r,i)=>`**${i+1}. ${r.team}**  ${r.w}-${r.l}${r.t?'-'+r.t:''}  (Diff ${r.diff})`); return new EmbedBuilder().setTitle(`${cname} Standings`).setDescription(lines.join("\n")||"No teams").setColor(0x1abc9c); });
    await interaction.reply({ embeds: embeds.slice(0,10) });
  }
} as const;
