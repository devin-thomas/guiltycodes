/* Mission Editor data layer. Replaceable: the shape of window.MISSION_DATA is the contract.
   STOCK, FIELDS and SCHEMA come from data/mission-editor.json (tools/mission-data.py), served as window.MISSION_RAW by the
   build. SCHEMA is the verified schema (mission_schema.json on the mission research): character names, value limits, value
   words, defaults and a proof level per field and side. encode() is carried over unchanged from the first editor and is
   checked against tests/mission_vectors.json by tools/check-mission-encoder.mjs. */
window.MISSION_DATA = (function(){
  var STOCK = window.MISSION_RAW.STOCK;
  var FIELDS = window.MISSION_RAW.FIELDS;
  var SCHEMA = window.MISSION_RAW.SCHEMA;
  var BY = {}; SCHEMA.fields.forEach(function(f){ BY[f.name]=f; });
  function title(n){ return n.indexOf('.')>=0 ? n : n.split('-').map(function(w){ return w.charAt(0)+w.slice(1).toLowerCase(); }).join('-'); }
  var CHARS = Object.keys(BY.char.values).map(function(i){ return +i===0 ? '(your pick)' : title(BY.char.values[i]); });
  var STAGES = null;  /* the schema has no stage names: ids only; -1 = opponent's stage */
  var BGMS = null;    /* no music names either; 0 = opponent's theme */
  var LIMITS = {};    /* [min, max] per field, from the schema (life 460 needs the life-460 cheat) */
  var WORDS = {};     /* value words per field, as the game's panel prints them */
  var PROOF = {};     /* proof level per field: {player, enemy} for per-side fields, a string for common ones */
  var NOTES = {};
  SCHEMA.fields.forEach(function(f){
    LIMITS[f.name]=[f.min,f.max];
    if(f.values) WORDS[f.name]=f.values;
    PROOF[f.name]=f.proven; if(f.proof_note) NOTES[f.name]=f.proof_note;
  });
  function neutral(over){ /* the schema's plain-fight record with overrides {p:{},e:{},c:{}}: p/e/c for every field */
    var r={p:{},e:{},c:{}};
    SCHEMA.fields.forEach(function(f){
      var d=f.default;
      if(d!==null && typeof d==='object'){ r.p[f.name]=d.player; r.e[f.name]=d.enemy; } else r.c[f.name]=d;
    });
    ['p','e','c'].forEach(function(s){ var o=(over||{})[s]||{}; Object.keys(o).forEach(function(k){ r[s][k]=o[k]; }); });
    return r;
  }
  function custom(name, slot, note, over){ var r=neutral(over); return {name:name, slot:slot, p:r.p, e:r.e, c:r.c, proven:true, note:note}; }
  var EXAMPLES = [   /* the proven custom missions set every field of the slot; the Mission 1 demo edits three */
    {name:"Mission 1 demo: Ky, 30 seconds, 210 life", slot:1, p:{life:210}, e:{char:2}, c:{time:30}, proven:true, note:"The first tested edit."},
    custom("Poison Sprint", 1, "Gold Potemkin, 30 seconds. You are poisoned, but your Tension is held full.",
      {p:{poison:1, tension_mode:2, tension:10000}, e:{char:6, sp:1, guard:-120}, c:{time:30, clear:1}}),
    custom("Glass Cannon", 2, "EX Ky with 30 life who deals no damage. You win on life at time-out.",
      {p:{life:105, seal_jump:1, burst:2}, e:{char:2, ex:1, life:30, no_normal:1, no_special:1, no_overdrive:1, burst:2}, c:{time:20, clear:0}}),
    custom("Ghost Survival", 3, "Survive 20 seconds against EX Order-Sol, who starts with full Tension.",
      {p:{heal:1, seal_guard:1}, e:{char:23, ex:1, tension_mode:2, tension:10000, invisible:1}, c:{time:20, clear:2}})
  ];
  function addr(m, off){ return 0x302BE0 + (m-1)*0x80 + off; }
  function hex(n, w){ var s=(n>>>0).toString(16).toUpperCase(); while(s.length<w)s='0'+s; return s; }
  function encode(edits){ /* edits: {mission:{p:{},e:{},c:{}}} -> pnach text */
    var lines=['gametitle=Guilty Gear XX Accent Core Plus (NTSC-U) [SLUS-21847] (F233A433)'];
    var ms=Object.keys(edits).map(Number).sort(function(a,b){return a-b;});
    var any=false;
    ms.forEach(function(m){
      var ed=edits[m], st=STOCK[m-1], body=[];
      FIELDS.forEach(function(f){
        [['p',f.p],['e',f.e],['c',f.e==null?f.p:null]].forEach(function(pair){
          var side=pair[0], off=pair[1]; if(off==null) return;
          if(side==='c' && f.e!=null) return; if(side!=='c' && f.e==null) return;
          var v=ed[side]&&ed[side][f.key]; if(v===undefined) return;
          var sv=st[side][f.key]; if(v===sv) return;
          body.push('// '+(side==='p'?'player ':side==='e'?'enemy ':'')+f.key+': '+sv+' -> '+v);
          body.push('patch=1,EE,1'+hex(addr(m,off),7)+',extended,'+hex(v & 0xFFFF,8));
        });
      });
      if(body.length){ any=true; lines.push(''); lines.push('[Mission '+m+': custom]'); lines.push('// Mission '+m+' (stock: vs '+st.enemy_name+')'); lines=lines.concat(body); }
    });
    return any?lines.join('\n')+'\n':'';
  }
  /* One section for all edited missions, in the style of the project's own pnach files. PCSX2 can drop some of several
     enabled cheat sections, so the page asks for one. The patch lines are exactly encode()'s. */
  function encodeOne(edits){
    var txt=encode(edits); if(!txt) return '';
    var lines=txt.split('\n'), ms=[];
    lines.forEach(function(l){ var m=/^\[Mission (\d+): custom\]$/.exec(l); if(m) ms.push(+m[1]); });
    var out=[lines[0], 'comment=Made with the Guilty Codes Mission Editor (beta). US only. RAM writes to the mission records in .data (reloaded from the disc at every boot).', ''];
    out.push('[Mission Editor]', 'author=Guilty Codes Mission Editor (beta)', 'description=Edits Mission'+(ms.length>1?'s ':' ')+ms.join(', ')+'. One cheat holds every edited mission.');
    lines.slice(1).forEach(function(l){ if(l!=='' && !/^\[Mission \d+: custom\]$/.test(l)) out.push(l); });
    return out.join('\n')+'\n';
  }
  /* What the game's mission info screen prints for a record (tests/panel/RESULTS.md: 25 shots of the real panel).
     get(side, key) -> value, side p | e | c. Returns {top:[[label,text]], rows:[[label, playerLines, enemyLines]]}. */
  function panel(get){
    var t=get('c','time');
    var top=[
      ['TIME', t<0?'INFINITY':String(t)],
      ['CLEAR', ({0:'JUDGE',1:'BEAT ENEMY',2:'TIME UP'})[get('c','clear')]||'?'],
      ['ENEMY', (BY.char.values[get('e','char')]||('#'+get('e','char')))+(get('e','ex')?':EX':'')+(get('e','sp')===1?':GOLD':get('e','sp')===2?':BLACK':'')]
    ];
    function dmg(s){
      var un=[!get(s,'no_normal')&&'NORMAL', !get(s,'no_special')&&'SPECIAL', !get(s,'no_overdrive')&&'OVERDRIVE'].filter(Boolean), da=get(s,'dead_angle'), pos=get(s,'position'), out=[];
      if(pos===1) out.push('TO GROUND'); else if(pos===2) out.push('TO AIR');
      if(!un.length && !da) out.push('NONE'); else if(un.length===3 && da) out.push('ALL');
      else { if(da) out.push('DEAD ANGLE'); out=out.concat(un); }
      return out;
    }
    function row(label, f){ return [label, f('p'), f('e')]; }
    var rows=[
      row('LIFE', function(s){ return [get(s,'life')+(get(s,'regain')?':REGAIN':'')+(get(s,'heal')?':HEAL':'')+(get(s,'poison')?':POISON':'')]; }),
      row('GUARD LEVEL', function(s){ return [String(get(s,'guard'))]; }),
      row('TENSION', function(s){ return [get(s,'tension')+':'+(({0:'NORMAL',1:'NO',2:'HOLD'})[get(s,'tension_mode')]||'?')]; }),
      row('PSYCH BURST', function(s){ return [({0:'-',1:'OK',2:'INFINITY'})[get(s,'burst')]||'?']; }),
      row('SEAL', function(s){ return [[get(s,'seal_special')&&'SPECIAL', get(s,'seal_jump')&&'JUMP', get(s,'seal_guard')&&'GUARD'].filter(Boolean).join(':')||'-']; }),
      row('COMBO DAMAGE', function(s){ return [get(s,'combo_over')>0?'OVER '+get(s,'combo_over'):get(s,'combo_under')>0?'UNDER '+get(s,'combo_under'):'-']; }),
      row('INSTANT KILL', function(s){ return [get(s,'no_ik')?'-':'OK']; }),
      row('DAMAGE', dmg)
    ];
    return {top:top, rows:rows};
  }
  return {STOCK:STOCK, FIELDS:FIELDS, CHARS:CHARS, STAGES:STAGES, BGMS:BGMS, LIMITS:LIMITS, EXAMPLES:EXAMPLES, encode:encode,
          SCHEMA:SCHEMA, WORDS:WORDS, PROOF:PROOF, NOTES:NOTES, neutral:neutral, encodeOne:encodeOne, panel:panel};
})();
