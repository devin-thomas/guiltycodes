/* Mission Editor data layer. Replaceable: the verified schema will swap CHARS, STAGES, BGMS, LIMITS and EXAMPLES.
   STOCK and FIELDS come from data/mission-editor.json (tools/mission-data.py), served as window.MISSION_RAW by the build.
   encode() is carried over unchanged from the first editor and must stay byte-compatible with the tested pnach files. */
window.MISSION_DATA = (function(){
  var STOCK = window.MISSION_RAW.STOCK;
  var FIELDS = window.MISSION_RAW.FIELDS;
  var CHARS = ["(your pick)","Sol","Ky","May","Millia","Axl","Potemkin","Chipp","Eddie","Baiken","Faust","Testament","Jam","Anji","Johnny","Venom","Dizzy","Slayer","I-No","Zappa","Bridget","Robo-Ky","A.B.A","Order-Sol","Kliff","Justice"];
  var STAGES = null;  /* pending: names from mission_schema.json; -1 = opponent's stage */
  var BGMS = null;    /* pending: -1/0 = opponent's theme */
  var LIMITS = {      /* pending verification against the loader and battle code */
    char:[0,25], colour:[0,21], ex:[0,1], sp:[0,2], regain:[0,999], life:[1,999], heal:[0,999], poison:[0,999],
    tension_mode:[0,2], tension:[0,10000], guard:[-120,128], no_normal:[0,1], no_special:[0,1], no_overdrive:[0,1], no_ik:[0,1],
    seal_special:[0,1], seal_jump:[0,1], seal_guard:[0,1], bgm:[0,60], stage:[-1,64], time:[-1,99], clear:[0,2],
    burst:[0,2], dead_angle:[0,1], combo_over:[0,99], combo_under:[0,99], position:[0,2], invisible:[0,1], gimmick:[-32768,32767]
  };
  var EXAMPLES = [   /* placeholders for the three showcase missions; replaced by the verified specs */
    {name:"Mission 1 demo: Ky, 30 seconds, 210 life", slot:1, p:{life:210}, e:{char:2}, c:{time:30}, proven:true},   /* the tested pnach; SLUS-21847_F233A433.mission1-demo */
    {name:"Gold Order-Sol, no special damage", slot:3, p:{char:1}, e:{char:23, sp:1, no_special:1}, c:{clear:1, time:60, stage:-1}},
    {name:"EX opponent, air-only damage", slot:5, p:{tension_mode:2, tension:10000}, e:{ex:1}, c:{}, pos:{p:2}},
    {name:"Survive an invisible foe, poisoned", slot:7, p:{poison:2}, e:{invisible:1}, c:{clear:2, time:45}}
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
  return {STOCK:STOCK, FIELDS:FIELDS, CHARS:CHARS, STAGES:STAGES, BGMS:BGMS, LIMITS:LIMITS, EXAMPLES:EXAMPLES, encode:encode};
})();
