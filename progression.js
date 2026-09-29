// Progression sur le GR34 : quelles portions du tracé principal ont été parcourues par les randonnées.
//
// Méthode (voir README) :
//  1. Le tracé principal est découpé en « morceaux » d'au plus 10 m.
//  2. Un morceau est couvert par une randonnée si un segment de la trace passe à moins de `tolerance` mètres
//     de son milieu, dans une direction proche (écart d'angle ≤ `angle` degrés, sens de marche indifférent).
//  3. Nettoyage, ligne par ligne : on comble les trous de moins de `trou` mètres entre deux portions couvertes,
//     puis on retire les portions couvertes de moins de `minimum` mètres (croisements, frôlements).
// Un morceau couvert plusieurs fois ne compte qu'une fois.
//  4. Contournements : la trace quitte le GR34 en A et le rejoint en B sur la même ligne. La portion A–B
//     n'est comptée que si l'utilisateur l'a décidé (arbitrage « compter »), repéré par la position de son milieu.
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
    return {n:len.length, sLat:F(sLat), sLon:F(sLon), eLat:F(eLat), eLon:F(eLon), mLat:F(mLat), mLon:F(mLon),
      len:F(len), dir:F(dir), sommet:Uint8Array.from(sommet), sec:Uint16Array.from(sec), lignes, sections,
      totalM:len.reduce((s,x)=>s+x,0), osm_base:gj.osm_base||null};
  }

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

  // Comble les trous courts puis retire les portions trop courtes, ligne par ligne
  function nettoyer(ref, brut, p){
    const cov=brut.slice();
    for(const [a,b] of ref.lignes){
      // trous : suites non couvertes encadrées par du couvert, de longueur ≤ p.trou
      let i=a;
      while(i<b){
        if(cov[i]){ i++; continue; }
        let j=i, L=0; while(j<b && !cov[j]){ L+=ref.len[j]; j++; }
        if(i>a && j<b && L<=p.trou) cov.fill(1,i,j);
        i=j;
      }
      // portions couvertes de longueur < p.minimum
      i=a;
      while(i<b){
        if(!cov[i]){ i++; continue; }
        let j=i, L=0; while(j<b && cov[j]){ L+=ref.len[j]; j++; }
        if(L<p.minimum) cov.fill(0,i,j);
        i=j;
      }
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
  function plusProche(ref, la, lo, tol){
    const {g, cle}=indexMorceaux(ref), cy=Math.floor(la/CELLULE), cx=Math.floor(lo/CELLULE);
    let bd=tol, bi=-1;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) for(const i of g.get(cle(cy+dy,cx+dx))||[]){
      const d=haversine([la,lo],[ref.mLat[i],ref.mLon[i]]); if(d<=bd){ bd=d; bi=i; }
    }
    return bi;
  }
  const ligneDe=(ref,i)=>ref.lignes.findIndex(([a,b])=>i>=a&&i<b);

  // Contournements d'une randonnée : la trace quitte le GR34 en A et le rejoint en B sur la même ligne du tracé.
  // Renvoie la portion du GR34 entre A et B (morceaux [debut, fin[) et la longueur de trace hors GR34.
  // `couvert` : couverture déjà acquise ; les morceaux déjà couverts ne sont pas comptés dans la portion.
  function contournements(ref, h, p, couvert){
    const ENTREE_MIN=100;   // une portion « sur le GR34 » doit faire au moins 100 m de trace pour servir d'appui
    const pts=h.pts, pos=pts.map(q=>plusProche(ref, q[0], q[1], p.tolerance));
    // suites de points sur / hors du GR34
    const suites=[]; let cur=null, km=0;
    pts.forEach((q,i)=>{ const L=i?haversine(pts[i-1],q):0; km+=L; const sur=pos[i]>=0;
      if(!cur||cur.sur!==sur){ cur={sur, i0:i, i1:i, m:0, km0:km}; suites.push(cur); } cur.i1=i; cur.m+=L; });
    // les suites « sur » trop courtes (croisements) sont traitées comme hors GR34
    for(const s of suites) if(s.sur && s.m<ENTREE_MIN) s.sur=false;
    const appuis=suites.filter(s=>s.sur);
    const out=[];
    for(let k=1;k<appuis.length;k++){
      const avant=appuis[k-1], apres=appuis[k];
      const a=pos[avant.i1], b=pos[apres.i0], la=ligneDe(ref,a);
      if(la<0 || la!==ligneDe(ref,b)) continue;
      const debut=Math.min(a,b), fin=Math.max(a,b)+1;
      let gr=0, portion=0; for(let i=debut;i<fin;i++){ portion+=ref.len[i]; if(!couvert[i]) gr+=ref.len[i]; }
      if(gr<=p.trou) continue;                         // déjà comblé automatiquement
      let trace=0; for(let i=avant.i1+1;i<=apres.i0;i++) trace+=haversine(pts[i-1],pts[i]);
      // garde-fou : si la portion du GR34 entre A et B est bien plus longue que le détour de la trace,
      // A et B ne délimitent pas un contournement (ex. : retour vers le point de départ d'une boucle)
      if(portion>3*trace+500) continue;
      const mil=(debut+fin)>>1;
      out.push({rando:h.id, debut, fin, gr_m:Math.round(gr), trace_m:Math.round(trace), i_a:avant.i1, i_b:apres.i0,
        km_trace:+(avant.km0/1000+avant.m/1000).toFixed(2), centre:[+ref.mLat[mil].toFixed(5), +ref.mLon[mil].toFixed(5)]});
    }
    return out;
  }

  // Portions d'une trace « sur le GR34 », pour l'affichage : un point est sur le GR34 si le morceau le plus proche
  // (à moins de la tolérance) est compté pour cette randonnée, ou s'il appartient à un contournement compté.
  // Renvoie des intervalles d'indices de points [[début, fin], …] (bornes incluses).
  function segmentsSurGR34(ref, h, cov, acceptes, p){
    const n=h.pts.length, sur=new Uint8Array(n);
    h.pts.forEach((q,i)=>{ const k=plusProche(ref, q[0], q[1], p.tolerance); if(k>=0 && cov[k]) sur[i]=1; });
    for(const c of acceptes) sur.fill(1, c.i_a, c.i_b+1);
    // lissage, cohérent avec le calcul : un écart de trace de moins de `trou` mètres entre deux passages sur le GR34
    // reste « sur le GR34 » ; un passage sur le GR34 de moins de 3 points (croisement) redevient « hors GR34 »
    for(let i=0;i<n;){
      let j=i, L=0; while(j<n && sur[j]===sur[i]){ if(j>i) L+=haversine(h.pts[j-1],h.pts[j]); j++; }
      if(i>0 && j<n && (sur[i] ? j-i<3 : L+haversine(h.pts[i-1],h.pts[i])+haversine(h.pts[j-1],h.pts[j])<=p.trou)) sur.fill(sur[i-1], i, j);
      i=j;
    }
    const out=[];
    for(let i=0;i<n;){ if(!sur[i]){ i++; continue; } let j=i; while(j+1<n && sur[j+1]) j++; out.push([i,j]); i=j+1; }
    return out;
  }

  // Décision enregistrée pour un contournement : même position (milieu de la portion) à 50 m près
  function decision(h, c){
    return (h.arbitrages||[]).find(a=>haversine(a.centre, c.centre)<=50)?.choix || null;
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
    // Contournements des randonnées publiées, avec la décision éventuelle ; « compter » ajoute la portion du GR34
    const contours=[], segments=new Map();
    randos.forEach((h,k)=>{
      const acceptes=[];
      for(const c of contournements(ref, h, p, h.gr34?cov:propres[k])){
        c.choix=decision(h, c); contours.push(c);
        if(c.choix==='compter'){ acceptes.push(c); propres[k].fill(1, c.debut, c.fin); if(h.gr34) cov.fill(1, c.debut, c.fin); }
      }
      parRando.set(h.id, +(metres(ref, propres[k])/1000).toFixed(2));
      segments.set(h.id, segmentsSurGR34(ref, h, propres[k], acceptes, p));
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

  return {PARAMS_DEFAUT, preparer, couvrir, nettoyer, contournements, calculer, portion};
})();
