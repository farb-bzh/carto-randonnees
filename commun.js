// Code partagé entre la carte publique (index.html) et la page d'administration (admin.html)
const $ = id => document.getElementById(id);

function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(d){ if(!d) return 'Date inconnue'; const x=new Date(d); return isNaN(x)?'Date inconnue':x.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}); }
function fmtKm(km){ return km.toLocaleString('fr-FR',{maximumFractionDigits:1}); }

function haversine(a,b){
  const R=6371000, r=Math.PI/180;
  const dLat=(b[0]-a[0])*r, dLon=(b[1]-a[1])*r;
  const s=Math.sin(dLat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

// Identifiant : date de début + premier point (lat, lon uniquement)
function makeId(date, p){ return ((date||'')+'_'+p[0]+'_'+p[1]).replace(/[^0-9A-Za-z_.-]/g,''); }

// Carte Leaflet avec les tuiles OSM standard ; affiche le bandeau #banner si les tuiles échouent
function creerCarte(){
  const map=L.map('map').setView([48.11,-1.68], 8);
  let tileErrors=0;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>'
  }).on('tileerror',()=>{ if(++tileErrors===3) $('banner').style.display='block'; }).addTo(map);
  return map;
}

// Trace façon balisage GR : liseré blanc + trait coloré.
// `surGR34` : intervalles d'indices de points sur le GR34 ([[début, fin], …]) -> rouge sur le GR34, violet ailleurs.
// Sans cette information (calcul pas encore fait) : rouge si la randonnée est cochée « GR34 ». Non cochée : gris.
const COULEUR_GR34='#C8102E', COULEUR_HORS_GR34='#A100FF', COULEUR_AUTRE='#5E6B68';
const COULEUR_TRACE_GR34='#0066FF';   // tracé de référence du GR34 (restant)
function morceauxColores(h, surGR34){
  if(!h.gr34) return [[h.pts, COULEUR_AUTRE]];
  if(!Array.isArray(surGR34)) return [[h.pts, COULEUR_GR34]];
  const out=[]; let fin=0;
  for(const [a,b] of surGR34){
    if(a>fin) out.push([h.pts.slice(fin, a+1), COULEUR_HORS_GR34]);   // points partagés : pas de coupure visible
    out.push([h.pts.slice(a, b+1), COULEUR_GR34]);
    fin=b;
  }
  if(fin<h.pts.length-1) out.push([h.pts.slice(fin), COULEUR_HORS_GR34]);
  return out.filter(([pts])=>pts.length>1);
}
function dessinerTrace(map, h, onClick, surGR34){
  const g=L.layerGroup([L.polyline(h.pts,{color:'#FFFFFF',weight:7,opacity:.95})]);
  const popup=()=>`<strong>${esc(h.name)}</strong><br>${fmtDate(h.date)}${h.km?' – '+fmtKm(h.km)+' km':''}`;
  for(const [pts,color] of morceauxColores(h, surGR34)) g.addLayer(L.polyline(pts,{color,weight:3.5}).bindPopup(popup));
  g.eachLayer(l=>l.on('click',()=>onClick(h.id)));
  return g.addTo(map);
}
// Épaisseur des traits colorés (mise en évidence de la randonnée sélectionnée)
function epaisseurTrace(g, w){ g.getLayers().slice(1).forEach(l=>l.setStyle({weight:w})); }

function htmlLegende(){
  return `<div class="legende">
    <span><i style="background:${COULEUR_GR34}"></i>Mes traces sur le GR34</span>
    <span><i style="background:${COULEUR_HORS_GR34}"></i>Mes traces hors GR34</span>
    <span><i style="background:${COULEUR_GR34};opacity:.45"></i>GR34 parcouru</span>
    <span><i style="background:${COULEUR_TRACE_GR34}"></i>GR34 restant</span>
  </div>`;
}

// Tracé de référence du GR34 (données OSM, ODbL), dessiné sous les randonnées.
// Tracé principal en trait continu, variantes en pointillés. Renvoie la couche, ou null si le fichier manque.
async function afficherGR34(map, url){
  let gj;
  try{ const r=await fetch(url); if(!r.ok) return null; gj=await r.json(); }
  catch(e){ console.error(e); return null; }
  map.createPane('gr34').style.zIndex=350;   // sous les traces (overlayPane = 400)
  map.attributionControl.addAttribution('Tracé GR34 : © <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>, ODbL');
  const layer=L.geoJSON(gj,{pane:'gr34', interactive:false,
    style:f=>({color:COULEUR_TRACE_GR34, weight:f.properties.role==='variante'?2:3, opacity:.9, dashArray:f.properties.role==='variante'?'5 6':null})
  }).addTo(map);
  layer.donnees=gj;
  return layer;
}

// Portions du GR34 parcourues : rouge atténué, au-dessus du tracé bleu mais sous les traces
function afficherParcouru(map, resume, ancienne){
  if(ancienne) map.removeLayer(ancienne);
  if(!resume?.parcouru?.coordinates?.length) return null;
  if(!map.getPane('parcouru')) map.createPane('parcouru').style.zIndex=360;   // gr34 = 350, traces = 400
  return L.geoJSON(resume.parcouru,{pane:'parcouru', interactive:false, style:{color:COULEUR_GR34, weight:6, opacity:.45}}).addTo(map);
}

// Bloc de synthèse : km parcourus / total, pourcentage, barre, détail par tronçon
function htmlProgression(resume){
  if(!resume) return '';
  const pct=resume.pourcentage, reste=Math.max(0, resume.total_km-resume.parcouru_km);
  const secs=resume.sections.filter(s=>s.parcouru_km>0).map(s=>
    `<li><span class="n">${esc(s.nom.replace('Chemin des Douaniers, ',''))}</span><span class="d">${fmtKm(s.parcouru_km)} / ${fmtKm(s.total_km)} km</span></li>`).join('');
  return `<div class="prog">
    <p class="prog-chiffres"><strong>${fmtKm(resume.parcouru_km)} km</strong> parcourus sur ${fmtKm(resume.total_km)} km
      – ${pct.toLocaleString('fr-FR',{maximumFractionDigits:1})} %</p>
    <div class="prog-barre" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${Math.min(100,pct)}%"></span></div>
    <p class="prog-reste">Reste ${fmtKm(reste)} km</p>
    ${secs?`<details><summary>Détail par tronçon</summary><ul class="prog-secs">${secs}</ul></details>`:''}
  </div>`;
}

function cadrer(map, list){
  if(list.length) map.fitBounds(L.latLngBounds(list.map(h=>L.polyline(h.pts).getBounds())),{padding:[30,30]});
}

// Format d'échange : FeatureCollection RFC 7946, une LineString par randonnée, positions [lon, lat(, alt)].
// `progression` (facultatif) : résumé du calcul, ajouté comme membre étranger (RFC 7946 § 6.1).
// `segments` (facultatif) : Map id -> intervalles de points sur le GR34, publiés pour colorer les traces.
function versGeoJSON(list, progression, segments){
  const gj={type:'FeatureCollection', features:list.map(h=>({
    type:'Feature',
    properties:{id:h.id, name:h.name, date:h.date, type:h.type, km:h.km, gr34:!!h.gr34, arbitrages:h.arbitrages||[],
      ...(segments?.has(h.id)?{sur_gr34:segments.get(h.id)}:{})},
    geometry:{type:'LineString', coordinates:h.pts.map(p=>p.length>2?[p[1],p[0],p[2]]:[p[1],p[0]])}
  }))};
  if(progression) gj.progression=progression;
  return gj;
}

function lireArbitrages(a){
  return Array.isArray(a) ? a.filter(x=>Array.isArray(x?.centre)&&isFinite(x.centre[0])&&isFinite(x.centre[1])&&['compter','ignorer'].includes(x.choix))
    .map(x=>({centre:[+x.centre[0],+x.centre[1]], choix:x.choix})) : [];
}

function depuisGeoJSON(gj, fname){
  if(gj?.type!=='FeatureCollection'||!Array.isArray(gj.features)) throw new Error(fname+' : ce n’est pas une FeatureCollection GeoJSON.');
  const out=[];
  for(const f of gj.features){
    const c=f?.geometry?.type==='LineString'?f.geometry.coordinates:null;
    if(!Array.isArray(c)||c.length<2) continue;
    const pts=c.filter(p=>isFinite(p[0])&&isFinite(p[1])).map(p=>p.length>2&&isFinite(p[2])?[p[1],p[0],p[2]]:[p[1],p[0]]);
    if(pts.length<2) continue;
    const pr=f.properties||{};
    let km=+pr.km;
    if(!isFinite(km)){ let d=0; for(let i=1;i<pts.length;i++) d+=haversine(pts[i-1],pts[i]); km=+(d/1000).toFixed(1); }
    const sur=Array.isArray(pr.sur_gr34) ? pr.sur_gr34.filter(r=>Array.isArray(r)&&Number.isInteger(r[0])&&Number.isInteger(r[1])&&r[0]<=r[1]&&r[1]<pts.length) : undefined;
    out.push({id:pr.id||makeId(pr.date,pts[0]), name:String(pr.name||'Sans nom'), date:pr.date||null, type:pr.type||null, km, gr34:pr.gr34===true, arbitrages:lireArbitrages(pr.arbitrages), surGR34:sur, pts});
  }
  if(!out.length) throw new Error(fname+' : aucune randonnée (LineString) trouvée.');
  return out;
}
