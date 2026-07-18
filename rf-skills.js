/* =============================================================================
 * RoboForge - Skills, Badges & MakerPassport  (rf-skills.js)
 * -----------------------------------------------------------------------------
 * Two layers, per the gamification report:
 *   1) Simulation-local badges (instant feedback, stay inside the sim)
 *   2) MakerPassport skill tree (permanent, XP accumulates across sims, no cap)
 * Pedagogy: a skill unlocks only if the student ALSO made at least one real
 * mistake (earned the error badge). A flawless run is celebrated but does NOT
 * unlock - the student is invited to go experiment and break something.
 * ========================================================================== */
(function (global) {
  'use strict';
  const LS = 'rf_skills_v1';
  const XP_PER_SIM = 10;

  // ---- global skill tree (each skill collects XP from several sims) --------
  const SKILLS = [
    { id:'dyk',     name:'Dinamik Yön Kontrolü', icon:'🧭', cat:'Temel Sürüş',
      desc:'Robotun anlık hata sinyaline bakıp yönünü sürekli düzeltmesi. Çizgi izleme, labirent ve PID sürüşünün ortak temeli.',
      sims:['line','linemaze','maze','pid','fare'] },
    { id:'sensor',  name:'Sensör ve Algı', icon:'👁️', cat:'Temel Sürüş',
      desc:'Sensör verisini doğru okumak, gürültüyü ayıklamak ve karara çevirmek.',
      sims:['line','light','obstacle','sinyal','rov'] },
    { id:'power',   name:'Güç ve Enerji Yönetimi', icon:'🔋', cat:'Kontrol Mühendisliği',
      desc:'Voltaj, akım ve kapasiteyi görevin ihtiyacına göre dengelemek.',
      sims:['line','solar','cansat','drone','roket'] },
    { id:'control', name:'Kontrol Teorisi (PID)', icon:'🎛️', cat:'Kontrol Mühendisliği',
      desc:'Orantı, türev ve integral terimleriyle kararlı, salınımsız kontrol kurmak.',
      sims:['pid','balance','drone','hill'] },
    { id:'mech',    name:'Mekanik Tasarım ve Denge', icon:'⚙️', cat:'Sürü & Lokomosyon',
      desc:'Ağırlık merkezi, tutuş ve şasi geometrisinin davranışa etkisi.',
      sims:['line','balance','hexapod','kol','vinc'] },
    { id:'nav',     name:'Görev Planlama ve Navigasyon', icon:'🗺️', cat:'Görev & Strateji',
      desc:'Hedefe giden yolu planlamak, engelleri ve sırayı yönetmek.',
      sims:['maze','depo','delivery','park','rescue'] },
    { id:'auto',    name:'Fabrika ve Otomasyon', icon:'🏭', cat:'Fabrika & Otomasyon',
      desc:'Tekrarlayan süreçleri sensör ve zamanlama ile otomatikleştirmek.',
      sims:['bant','cnc','sera','depo'] },
    { id:'swarm',   name:'Sürü ve İş Birliği', icon:'🐝', cat:'Sürü & Lokomosyon',
      desc:'Birden çok robotun çarpışmadan, ortak hedefe göre davranması.',
      sims:['swarm','convoy','soccer'] },
  ];

  // ---- in-sim badges ------------------------------------------------------
  const BADGES = {
    ilk_hata: { id:'ilk_hata', icon:'💥', name:'İlk Hata (Teori Çelişkisi)',
      msg:'Harika bir mühendislik tecrübesi! Hata yapmak, teorinin nerede tıkandığını görmenin en hızlı yoludur.' },
    pist1: { id:'pist1', icon:'⭐', name:'Pist Uzmanı (1 Yıldız)',
      msg:'Kolay ve orta zorlukta iki pisti tamamladın. Robotun temel sürüşü oturdu.' },
    pist2: { id:'pist2', icon:'🌟', name:'Pist Uzmanı (2 Yıldız)',
      msg:'Eğrisel, kesikli ve kabus rotalarını da bitirdin. Aynı şasiyle ince ayar yapmayı öğrendin.' },
  };

  // line-follower track groups (7 tracks, index based)
  const LF = { easy:[0,1], mid:[2,3], star2:[3,5,6], total:7 };

  function blank(){ return { xp:{}, unlocked:{}, badges:{}, sims:{} }; }
  function load(){ try{ return Object.assign(blank(), JSON.parse(localStorage.getItem(LS))||{}); }catch(e){ return blank(); } }
  function save(st){ try{ localStorage.setItem(LS, JSON.stringify(st)); }catch(e){}
    try{ if(global.RFCloud && global.RFCloud.push) global.RFCloud.push('skills', st); }catch(e){} return st; }
  function simState(st, sim){ if(!st.sims[sim]) st.sims[sim]={ tracks:[], badges:{}, bestRobot:false }; return st.sims[sim]; }

  // ---- badges -------------------------------------------------------------
  function hasBadge(sim, id){ const st=load(); return !!(st.sims[sim] && st.sims[sim].badges[id]); }
  function award(sim, id){
    const st=load(); const s=simState(st,sim);
    if(s.badges[id]) return null;                 // already earned, no repeat toast
    s.badges[id]={ ts:Date.now() };
    st.badges[sim+':'+id]={ ts:Date.now() };
    save(st);
    return BADGES[id]||{ id:id, icon:'🏅', name:id, msg:'' };
  }
  function badgesOf(sim){ const st=load(); const s=st.sims[sim]; if(!s) return [];
    return Object.keys(s.badges).map(id=>BADGES[id]).filter(Boolean); }

  // ---- progress recording -------------------------------------------------
  function markTrack(sim, idx){
    const st=load(); const s=simState(st,sim);
    if(s.tracks.indexOf(idx)<0){ s.tracks.push(idx); save(st); }
    return s.tracks.slice();
  }
  function markBestRobot(sim, ok){ const st=load(); simState(st,sim).bestRobot=!!ok; save(st); }
  function tracksOf(sim){ const st=load(); return (st.sims[sim]&&st.sims[sim].tracks)||[]; }

  // ---- line-follower badge checks (call after a successful run) -----------
  function checkLineBadges(trackIdx){
    const earned=[]; markTrack('line', trackIdx);
    const t=tracksOf('line');
    const has=(arr)=>arr.some(i=>t.indexOf(i)>=0);
    if(has(LF.easy) && has(LF.mid)){ const b=award('line','pist1'); if(b) earned.push(b); }
    if(LF.star2.every(i=>t.indexOf(i)>=0)){ const b=award('line','pist2'); if(b) earned.push(b); }
    return earned;
  }

  // ---- skill unlock -------------------------------------------------------
  // Unlock needs: best robot (no critical build error) + ALL tracks + at least
  // one real mistake (the error badge). Zero-error => celebrated, not unlocked.
  function evaluateLine(){
    const st=load(); const s=simState(st,'line');
    const allTracks = s.tracks.length >= LF.total;
    const madeError = !!s.badges.ilk_hata;
    if(!(s.bestRobot && allTracks)) return { unlocked:false, perfect:false, reason:'incomplete' };
    if(!madeError) return { unlocked:false, perfect:true, reason:'flawless' };
    return addSkillXp('dyk','line');
  }
  function addSkillXp(skillId, sim){
    const st=load();
    const key=skillId+':'+sim;
    if(st.unlocked[key]) return { unlocked:true, already:true, skill:skillById(skillId), xp:st.xp[skillId]||0 };
    st.unlocked[key]=true;
    st.xp[skillId]=(st.xp[skillId]||0)+XP_PER_SIM;
    save(st);
    return { unlocked:true, already:false, skill:skillById(skillId), xp:st.xp[skillId], gained:XP_PER_SIM };
  }
  function skillById(id){ return SKILLS.filter(s=>s.id===id)[0]||null; }
  function skillXp(id){ return load().xp[id]||0; }
  function skillSims(id){ const st=load(); return (skillById(id)||{sims:[]}).sims.filter(s=>st.unlocked[id+':'+s]); }
  function totalXp(){ const st=load(); return Object.keys(st.xp).reduce((a,k)=>a+st.xp[k],0); }
  function reset(){ try{ localStorage.removeItem(LS); }catch(e){} }

  const API={ SKILLS, BADGES, LF, XP_PER_SIM, load, save, hasBadge, award, badgesOf,
    markTrack, markBestRobot, tracksOf, checkLineBadges, evaluateLine, addSkillXp,
    skillById, skillXp, skillSims, totalXp, reset };
  global.RFSkills=API;
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
