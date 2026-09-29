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

// Trace façon balisage GR : liseré blanc + trait coloré (rouge pour le GR34, gris sinon)
const COULEUR_GR34='#C8102E', COULEUR_AUTRE='#5E6B68';
function dessinerTrace(map, h, onClick){
  const g=L.layerGroup([
    L.polyline(h.pts,{color:'#FFFFFF',weight:7,opacity:.95}),
    L.polyline(h.pts,{color:h.gr34?COULEUR_GR34:COULEUR_AUTRE,weight:3.5})
  ]);
  g.eachLayer(l=>l.on('click',()=>onClick(h.id)));
  g.getLayers()[1].bindPopup(()=>`<strong>${esc(h.name)}</strong><br>${fmtDate(h.date)}${h.km?' – '+fmtKm(h.km)+' km':''}`);
  return g.addTo(map);
}

// Tracé de référence du GR34 (données OSM, ODbL), dessiné sous les randonnées.
// Tracé principal en trait continu, variantes en pointillés. Renvoie la couche, ou null si le fichier manque.
async function afficherGR34(map, url){
  let gj;
  try{ const r=await fetch(url); if(!r.ok) return null; gj=await r.json(); }
  catch(e){ console.error(e); return null; }
  map.createPane('gr34').style.zIndex=350;   // sous les traces (overlayPane = 400)
  map.attributionControl.addAttribution('Tracé GR34 : © <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>, ODbL');
  return L.geoJSON(gj,{pane:'gr34', interactive:false,
    style:f=>({color:'#1F4E79', weight:f.properties.role==='variante'?2:3, opacity:.75, dashArray:f.properties.role==='variante'?'5 6':null})
  }).addTo(map);
}

function cadrer(map, list){
  if(list.length) map.fitBounds(L.latLngBounds(list.map(h=>L.polyline(h.pts).getBounds())),{padding:[30,30]});
}

// Format d'échange : FeatureCollection RFC 7946, une LineString par randonnée, positions [lon, lat(, alt)]
function versGeoJSON(list){
  return {type:'FeatureCollection', features:list.map(h=>({
    type:'Feature',
    properties:{id:h.id, name:h.name, date:h.date, type:h.type, km:h.km, gr34:!!h.gr34},
    geometry:{type:'LineString', coordinates:h.pts.map(p=>p.length>2?[p[1],p[0],p[2]]:[p[1],p[0]])}
  }))};
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
    out.push({id:pr.id||makeId(pr.date,pts[0]), name:String(pr.name||'Sans nom'), date:pr.date||null, type:pr.type||null, km, gr34:pr.gr34===true, pts});
  }
  if(!out.length) throw new Error(fname+' : aucune randonnée (LineString) trouvée.');
  return out;
}
