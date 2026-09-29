// Progression sur le GR34 : quelles portions du tracé principal ont été parcourues par les randonnées.
//
// Méthode (voir README) :
//  1. Le tracé principal est découpé en « morceaux » d'au plus 10 m.
//  2. Un morceau est couvert par une randonnée si un segment de la trace passe à moins de `tolerance` mètres
//     de son milieu, dans une direction proche (écart d'angle ≤ `angle` degrés, sens de marche indifférent).
//  3. Nettoyage, sur le réseau (les tronçons OSM sont reliés à leurs jonctions) : on comble les trous de moins de
//     `trou` mètres entre deux portions couvertes, puis on retire les portions couvertes de moins de `minimum` mètres
//     (croisements, frôlements). Un morceau couvert plusieurs fois ne compte qu'une fois.
//  4. Portions à arbitrer : non parcourues mais encadrées par du parcouru, ou longées à faible distance par une trace.
//     Elles ne comptent que si l'utilisateur l'a décidé (arbitrage « compter »), repéré par position.
const Progression = (() => {
  const PAS = 10, R = 6371000, D2R = Math.PI / 180, CELLULE = 0.002;   // cellule d'index ≈ 220 m × 150 m
  const PARAMS_DEFAUT = {tolerance:40, trou:100, minimum:200, angle:45};

  // Découpe du tracé principal. Un « morceau » = début, milieu, fin, longueur, direction, section, ligne.
  function preparer(gj){
    const sLat=[], sLon=[], eLat=[], eLon=[], mLat=[], mLon=[], len=[], dir=[], sommet=[], sec=[];
    const lignes=[], sections=[];
    for(const f of gj.features){
      if(f.properties?.role!=='principal') continue;
      const si=sections.length; sections.push({nom:f.properties.name, osm_id:f.properties.osm_id, total:0});
      for(const coords of f.geometry.coordinates){
        const debut=len.length;
        for(let i=1;i<coords.length;i++){
          const [lo1,la1]=coords[i-1], [lo2,la2]=coords[i];
          const L=haversine([la1,lo1],[la2,lo2]); if(!(L>0)) continue;
          const k=Math.ceil(L/PAS), c=Math.cos(la1*D2R);
          const d=Math.atan2((la2-la1), (lo2-lo1)*c);
          for(let j=0;j<k;j++){
            const t0=j/k, t1=(j+1)/k, tm=(j+.5)/k;
            sLat.push(la1+(la2-la1)*t0); sLon.push(lo1+(lo2-lo1)*t0);
            eLat.push(la1+(la2-la1)*t1); eLon.push(lo1+(lo2-lo1)*t1);
            mLat.push(la1+(la2-la1)*tm); mLon.push(lo1+(lo2-lo1)*tm);
            len.push(L/k); dir.push(d); sommet.push(j===0?1:0); sec.push(si);
          }
          sections[si].total+=L;
        }
        if(len.length>debut) lignes.push([debut,len.length]);   // [premier morceau, fin exclue]
      }
    }
    const F=a=>Float64Array.from(a);
    const ref={n:len.length, sLat:F(sLat), sLon:F(sLon), eLat:F(eLat), eLon:F(eLon), mLat:F(mLat), mLon:F(mLon),
      len:F(len), dir:F(dir), sommet:Uint8Array.from(sommet), sec:Uint16Array.from(sec), lignes, sections,
      totalM:len.reduce((s,x)=>s+x,0), osm_base:gj.osm_base||null};
    relier(ref);
    return ref;
  }

  // Le tracé est un réseau : les lignes OSM (tronçons) se raccordent à leurs extrémités, parfois au milieu d'une
  // autre ligne. `ref.lig[i]` = ligne du morceau i ; `ref.liens` : morceau d'extrémité -> morceaux raccordés (≤ 15 m).
  const JONCTION=15;
  function relier(ref){
    const lig=new Uint16Array(ref.n); ref.lignes.forEach(([a,b],l)=>lig.fill(l,a,b)); ref.lig=lig;
    const liens=new Map(), lier=(x,y)=>{ if(x===y) return; for(const [u,v] of [[x,y],[y,x]]){ const l=liens.get(u)||liens.set(u,[]).get(u); if(!l.includes(v)) l.push(v); } };
    const {g, cle}=indexMorceaux(ref);
    ref.lignes.forEach(([a,b])=>{
      for(const [e,la,lo] of [[a,ref.sLat[a],ref.sLon[a]], [b-1,ref.eLat[b-1],ref.eLon[b-1]]]){
        const cy=Math.floor(la/CELLULE), cx=Math.floor(lo/CELLULE);
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) for(const q of g.get(cle(cy+dy,cx+dx))||[]){
          if(q===e || (lig[q]===lig[e] && Math.abs(q-e)===1)) continue;
          if(haversine([la,lo],[ref.sLat[q],ref.sLon[q]])<=JONCTION || haversine([la,lo],[ref.eLat[q],ref.eLon[q]])<=JONCTION) lier(e,q);
        }
      }
    });
    ref.liens=liens;
  }
  function voisins(ref, i){
    const [a,b]=ref.lignes[ref.lig[i]], out=[];
    if(i>a) out.push(i-1); if(i<b-1) out.push(i+1);
    const l=ref.liens.get(i); if(l) out.push(...l);
    return out;
  }
  // Ensemble connexe de morceaux vérifiant `pred`, à partir de `depart` ; null si sa longueur dépasse `limite`.
  // `bords` : morceaux voisins ne vérifiant pas `pred` ; `bouts` : morceaux de l'ensemble touchant un bord.
  function explorer(ref, depart, pred, limite){
    const vu=new Set([depart]), pile=[depart], morceaux=[], bords=new Set(), bouts=[];
    let L=0;
    while(pile.length){
      const i=pile.pop(); morceaux.push(i); L+=ref.len[i]; if(L>limite) return null;
      let bout=false;
      for(const v of voisins(ref, i)){
        if(vu.has(v)) continue;
        if(pred(v)){ vu.add(v); pile.push(v); } else { bords.add(v); bout=true; }
      }
      if(bout) bouts.push(i);
    }
    return {morceaux, L, bords:[...bords], bouts, vu};
  }
  // Morceaux triés -> plages [début, fin[ consécutives
  function plages(morceaux){
    const m=[...morceaux].sort((a,b)=>a-b), out=[];
    for(const i of m){ const d=out[out.length-1]; if(d && d[1]===i) d[1]=i+1; else out.push([i,i+1]); }
    return out;
  }
  const remplir=(cov, pl, v)=>{ for(const [a,b] of pl) cov.fill(v,a,b); };

  // Index spatial des segments des randonnées : cellule -> liste [indexRando, lat1, lon1, lat2, lon2, extrémités]
  // extrémités : 1 = premier segment de la trace, 2 = dernier (pour ne pas couvrir au-delà du départ et de l'arrivée)
  function indexer(randos){
    const grille=new Map(), cle=(y,x)=>y*100000+x;
    randos.forEach((h,ri)=>{
      for(let i=1;i<h.pts.length;i++){
        const [a1,o1]=h.pts[i-1], [a2,o2]=h.pts[i];
        const ext=(i===1?1:0)|(i===h.pts.length-1?2:0);
        const y0=Math.floor(Math.min(a1,a2)/CELLULE), y1=Math.floor(Math.max(a1,a2)/CELLULE);
        const x0=Math.floor(Math.min(o1,o2)/CELLULE), x1=Math.floor(Math.max(o1,o2)/CELLULE);
        for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){ const k=cle(y,x); (grille.get(k)||grille.set(k,[]).get(k)).push([ri,a1,o1,a2,o2,ext]); }
      }
    });
    return {grille, cle};
  }

  // Couverture brute : un tableau 0/1 par randonnée (même ordre que `randos`)
  function couvrir(ref, randos, p){
    const cov=randos.map(()=>new Uint8Array(ref.n));
    if(!randos.length) return cov;
    const {grille, cle}=indexer(randos), tol2=p.tolerance*p.tolerance, amax=p.angle*D2R;
    // Par morceau et par randonnée : distance au point le plus proche de la trace, et ce point est-il le départ/l'arrivée ?
    const best=new Float64Array(randos.length).fill(Infinity), auBout=new Uint8Array(randos.length), ok=new Uint8Array(randos.length);
    const vus=[];
    for(let i=0;i<ref.n;i++){
      const la=ref.mLat[i], lo=ref.mLon[i], cy=Math.floor(la/CELLULE), cx=Math.floor(lo/CELLULE);
      const c=Math.cos(la*D2R), kx=c*R*D2R, ky=R*D2R, d0=ref.dir[i];
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        const segs=grille.get(cle(cy+dy,cx+dx)); if(!segs) continue;
        for(const [ri,a1,o1,a2,o2,ext] of segs){
          const x1=(o1-lo)*kx, y1=(a1-la)*ky, x2=(o2-lo)*kx, y2=(a2-la)*ky, vx=x2-x1, vy=y2-y1, L2=vx*vx+vy*vy;
          let t=L2?-(x1*vx+y1*vy)/L2:0;
          const bout=(t<=0 && ext&1) || (t>=1 && ext&2);   // point le plus proche = départ ou arrivée de la trace
          t=t<0?0:t>1?1:t;
          const px=x1+t*vx, py=y1+t*vy, d2=px*px+py*py;
          if(best[ri]===Infinity) vus.push(ri);
          if(d2<best[ri]){ best[ri]=d2; auBout[ri]=bout?1:0; }
          if(d2>tol2 || bout) continue;
          let da=Math.abs(Math.atan2(a2-a1,(o2-o1)*c)-d0)%Math.PI; if(da>Math.PI/2) da=Math.PI-da;
          if(L2 && da>amax) continue;
          ok[ri]=1;
        }
      }
      // couvert si un segment proche et bien orienté existe, et si le morceau n'est pas au-delà d'une extrémité
      for(const ri of vus){ if(ok[ri] && !auBout[ri]) cov[ri][i]=1; best[ri]=Infinity; auBout[ri]=0; ok[ri]=0; }
      vus.length=0;
    }
    return cov;
  }

  // Trous non couverts encadrés (au moins deux bords couverts) d'au plus `limite` m, jonctions comprises.
  // L'exploration part des morceaux couverts et s'arrête dès que la limite est dépassée (coût borné).
  function trousEncadres(ref, cov, limite){
    const out=[], traite=new Uint8Array(ref.n);
    for(let i=0;i<ref.n;i++){
      if(!cov[i]) continue;
      for(const v of voisins(ref, i)){
        if(cov[v] || traite[v]) continue;
        const t=explorer(ref, v, x=>!cov[x], limite);
        if(!t) continue;
        for(const x of t.morceaux) traite[x]=1;
        if(t.bords.length>=2) out.push(t);
      }
    }
    return out;
  }

  // Comble les trous courts puis retire les portions trop courtes, sur le réseau (jonctions comprises)
  function nettoyer(ref, brut, p){
    const cov=brut.slice();
    // trous non couverts encadrés par du couvert, de longueur ≤ p.trou
    for(const t of trousEncadres(ref, brut, p.trou)) for(const x of t.morceaux) cov[x]=1;
    // portions couvertes de longueur < p.minimum
    const vu=new Uint8Array(ref.n), cov0=cov.slice();
    for(let i=0;i<ref.n;i++){
      if(!cov0[i] || vu[i]) continue;
      const t=explorer(ref, i, x=>cov0[x]===1, Infinity);
      for(const x of t.morceaux) vu[x]=1;
      if(t.L<p.minimum) for(const x of t.morceaux) cov[x]=0;
    }
    return cov;
  }

  function metres(ref, cov){ let s=0; for(let i=0;i<ref.n;i++) if(cov[i]) s+=ref.len[i]; return s; }

  function parSection(ref, cov){
    const c=new Float64Array(ref.sections.length);
    for(let i=0;i<ref.n;i++) if(cov[i]) c[ref.sec[i]]+=ref.len[i];
    return ref.sections.map((s,k)=>({nom:s.nom, osm_id:s.osm_id, total_km:+(s.total/1000).toFixed(2), parcouru_km:+(c[k]/1000).toFixed(2)}));
  }

  // Géométrie des portions couvertes, en reprenant les sommets d'origine du tracé ([lon, lat])
  function geometrie(ref, cov){
    const out=[];
    for(const [a,b] of ref.lignes){
      let cur=null;
      for(let i=a;i<b;i++){
        if(cov[i]){
          if(!cur) cur=[[ref.sLon[i],ref.sLat[i]]];
          else if(ref.sommet[i]) cur.push([ref.sLon[i],ref.sLat[i]]);
          if(i+1===b || !cov[i+1]){ cur.push([ref.eLon[i],ref.eLat[i]]); out.push(cur); cur=null; }
        }
      }
    }
    return out;
  }

  // Index des milieux des morceaux, pour trouver le morceau du GR34 le plus proche d'un point
  function indexMorceaux(ref){
    if(ref._grille) return ref._grille;
    const g=new Map(), cle=(y,x)=>y*100000+x;
    for(let i=0;i<ref.n;i++){ const k=cle(Math.floor(ref.mLat[i]/CELLULE),Math.floor(ref.mLon[i]/CELLULE)); (g.get(k)||g.set(k,[]).get(k)).push(i); }
    return ref._grille={g, cle};
  }
  const TROU_MAX=2000;   // au-delà, une portion non parcourue n'est pas proposée à l'arbitrage

  // Portions à arbitrer (« contournements »), de plus de `trou` m (les plus courtes sont déjà comblées) :
  //  1. portions du GR34 NON parcourues, encadrées par des portions parcourues (jonctions entre tronçons comprises),
  //     d'au plus TROU_MAX m (balisage modifié, sentier parallèle, passage par l'intérieur…) ;
  //  2. portions NON parcourues qu'une trace longe à faible distance (`large` : couverture avec 2 × la tolérance).
  // Chaque portion est rattachée à une randonnée publiée (pour situer et colorer la trace).
  // `cov` : couverture de l'ensemble des randonnées publiées ; `propres` : couverture de chaque randonnée.
  function contournements(ref, randos, propres, cov, large, p){
    const out=[], pris=new Uint8Array(ref.n);
    for(const t of trousEncadres(ref, cov, TROU_MAX)){
      if(t.L<=p.trou) continue;                                   // déjà comblé automatiquement
      // randonnée qui parcourt tous les bords (à défaut, l'un d'eux)
      let k=randos.findIndex((h,q)=>h.gr34 && t.bords.every(b=>propres[q][b]));
      if(k<0) k=randos.findIndex((h,q)=>h.gr34 && t.bords.some(b=>propres[q][b]));
      if(k<0) continue;
      out.push(situer(ref, randos[k], k, t)); for(const x of t.morceaux) pris[x]=1;
    }
    randos.forEach((h,k)=>{
      if(!h.gr34) return;
      const vu=new Uint8Array(ref.n), pred=x=>!cov[x] && !pris[x] && large[k][x]===1;
      for(let i=0;i<ref.n;i++){
        if(vu[i] || !pred(i)) continue;
        const t=explorer(ref, i, pred, Infinity);
        for(const x of t.morceaux) vu[x]=1;
        if(t.L>p.trou && t.L<=TROU_MAX){ out.push(situer(ref, h, k, t)); for(const x of t.morceaux) pris[x]=1; }
      }
    });
    return out;
  }

  // Position d'un contournement sur la trace de la randonnée : points les plus proches de ses deux extrémités
  function situer(ref, h, k, t){
    const pts=h.pts, proche=m=>{ let bd=Infinity, bi=0; pts.forEach((q,i)=>{ const d=haversine(q,[ref.mLat[m],ref.mLon[m]]); if(d<bd){ bd=d; bi=i; } }); return bi; };
    const bouts=t.bouts.length ? t.bouts : t.morceaux;
    let i_a=proche(bouts[0]), i_b=proche(bouts[bouts.length-1]); if(i_a>i_b) [i_a,i_b]=[i_b,i_a];
    let avant=0, trace=0; for(let i=1;i<=i_b;i++){ const d=haversine(pts[i-1],pts[i]); if(i<=i_a) avant+=d; else trace+=d; }
    const pl=plages(t.morceaux), mil=[...t.morceaux].sort((a,b)=>a-b)[t.morceaux.length>>1];
    return {rando:h.id, k, plages:pl, trous:pl, gr_m:Math.round(t.L), trace_m:Math.round(trace), i_a, i_b,
      km_trace:+(avant/1000).toFixed(2), centre:[+ref.mLat[mil].toFixed(5), +ref.mLon[mil].toFixed(5)]};
  }

  // Portions d'une trace « sur le GR34 », pour l'affichage : un point est sur le GR34 si le morceau le plus proche
  // (à moins de la tolérance) est compté pour cette randonnée, ou s'il appartient à un contournement compté.
  // Renvoie des intervalles d'indices de points [[début, fin], …] (bornes incluses).
  function segmentsSurGR34(ref, h, cov, acceptes, p){
    const n=h.pts.length, sur=new Uint8Array(n), amax=p.angle*D2R, pts=h.pts, {g, cle}=indexMorceaux(ref);
    // Un morceau compté à moins de `dist` mètres du point q, et (si `dir` est fourni) orienté comme la trace ?
    // Tous les morceaux à portée sont examinés (le tracé OSM peut superposer deux lignes au même endroit).
    const procheCompte=(q, dist, dir)=>{
      const cy=Math.floor(q[0]/CELLULE), cx=Math.floor(q[1]/CELLULE);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) for(const k of g.get(cle(cy+dy,cx+dx))||[]){
        if(!cov[k] || haversine(q,[ref.mLat[k],ref.mLon[k]])>dist) continue;
        if(dir==null) return true;
        let da=Math.abs(dir-ref.dir[k])%Math.PI; if(da>Math.PI/2) da=Math.PI-da;
        if(da<=amax) return true;
      }
      return false;
    };
    // mêmes critères que le calcul : proche d'un morceau compté ET dans la même direction que le sentier
    // (un chemin d'accès qui arrive perpendiculairement au GR34 reste « hors GR34 »)
    pts.forEach((q,i)=>{
      const a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)];
      const dir=(a[0]!==b[0]||a[1]!==b[1]) ? Math.atan2(b[0]-a[0], (b[1]-a[1])*Math.cos(q[0]*D2R)) : null;
      if(procheCompte(q, p.tolerance, dir)) sur[i]=1;
    });
    // suites de points de même état : [début, fin exclue, longueur de trace en m]
    const suites=()=>{ const out=[]; for(let i=0;i<n;){ let j=i, L=0; while(j<n && sur[j]===sur[i]){ if(j>i) L+=haversine(pts[j-1],pts[j]); j++; }
      if(i>0) L+=haversine(pts[i-1],pts[i]); if(j<n) L+=haversine(pts[j-1],pts[j]); out.push([i,j,L]); i=j; } return out; };
    // 1. passage sur le GR34 plus court que `minimum` (bout de chemin d'accès, croisement) -> hors GR34
    for(const [i,j,L] of suites()) if(sur[i] && L<p.minimum) sur.fill(0, i, j);
    // 2. contournements comptés -> sur le GR34
    for(const c of acceptes) sur.fill(1, c.i_a, c.i_b+1);
    // 3. écart entre deux passages sur le GR34 dû à l'imprécision GPS -> sur le GR34 : écart de moins de `trou` mètres,
    //    ou dont tous les points restent à moins de 2 × la tolérance d'une portion comptée (un vrai détour s'éloigne plus)
    for(const [i,j,L] of suites()){
      if(sur[i] || i===0 || j===n) continue;
      let colle=true; for(let k=i;k<j && colle;k++) colle=procheCompte(pts[k], 2*p.tolerance, null);
      if(L<=p.trou || colle) sur.fill(1, i, j);
    }
    const out=[];
    for(let i=0;i<n;){ if(!sur[i]){ i++; continue; } let j=i; while(j+1<n && sur[j+1]) j++; out.push([i,j]); i=j+1; }
    return out;
  }

  // Décision enregistrée pour un contournement : un arbitrage (de n'importe quelle randonnée publiée) dont la position
  // tombe à moins de 50 m de la portion. Tolérant aux changements de découpage et de méthode de détection.
  function correspond(ref, a, c){
    if(haversine(a.centre, c.centre)<=50) return true;
    for(const [d,f] of c.plages) for(let i=d;i<f;i+=3) if(haversine(a.centre,[ref.mLat[i],ref.mLon[i]])<=50) return true;
    return false;
  }
  function decision(ref, randos, c){
    for(const h of randos){
      if(!h.gr34) continue;
      const a=(h.arbitrages||[]).find(a=>correspond(ref, a, c));
      if(a) return a.choix;
    }
    return null;
  }

  // Calcul complet. `randos` : toutes les randonnées ; seules celles avec gr34=true comptent dans le total.
  // Chaque randonnée peut porter des arbitrages : [{centre:[lat,lon], choix:'compter'|'ignorer'}].
  function calculer(ref, randos, p){
    const brut=couvrir(ref, randos, p);
    const parRando=new Map(), union=new Uint8Array(ref.n), propres=[];
    randos.forEach((h,k)=>{
      const c=nettoyer(ref, brut[k], p); propres.push(c);
      if(h.gr34) for(let i=0;i<ref.n;i++) union[i]|=brut[k][i];
    });
    const cov=nettoyer(ref, union, p);
    // Contournements (portions non parcourues entre deux portions parcourues), avec la décision éventuelle ;
    // « compter » ajoute la portion du GR34 au total et à la randonnée qui l'encadre
    // couverture « large » (2 × la tolérance) des randonnées publiées, pour repérer les portions longées à faible distance
    const large=couvrir(ref, randos.map(h=>h.gr34?h:{...h, pts:[]}), {...p, tolerance:2*p.tolerance});
    const contours=contournements(ref, randos, propres, cov, large, p), acceptes=randos.map(()=>[]), segments=new Map();
    for(const c of contours){
      c.choix=decision(ref, randos, c);
      if(c.choix==='compter'){
        remplir(cov, c.plages, 1); remplir(propres[c.k], c.plages, 1);
        // la trace entre les deux bords n'est colorée « sur le GR34 » que si elle a une longueur comparable (vrai détour)
        if(c.trace_m<=3*c.gr_m+500) acceptes[c.k].push(c);
      }
    }
    randos.forEach((h,k)=>{
      parRando.set(h.id, +(metres(ref, propres[k])/1000).toFixed(2));
      segments.set(h.id, segmentsSurGR34(ref, h, propres[k], acceptes[k], p));
    });
    const parcouru=metres(ref, cov);
    return {
      parRando, contours, segments,
      resume:{
        parametres:{...p},
        total_km:+(ref.totalM/1000).toFixed(2),
        parcouru_km:+(parcouru/1000).toFixed(2),
        pourcentage:+(100*parcouru/ref.totalM).toFixed(2),
        sections:parSection(ref, cov),
        gr34_osm_base:ref.osm_base,
        calcule_le:new Date().toISOString(),
        parcouru:{type:'MultiLineString', coordinates:geometrie(ref, cov)}
      }
    };
  }

  // Géométrie d'une portion [debut, fin[ du tracé, en [lat, lon] pour Leaflet
  function portion(ref, debut, fin){
    const out=[[ref.sLat[debut], ref.sLon[debut]]];
    for(let i=debut+1;i<fin;i++) if(ref.sommet[i]) out.push([ref.sLat[i], ref.sLon[i]]);
    out.push([ref.eLat[fin-1], ref.eLon[fin-1]]);
    return out;
  }

  return {PARAMS_DEFAUT, preparer, couvrir, nettoyer, contournements, calculer, portion, correspond};
})();
