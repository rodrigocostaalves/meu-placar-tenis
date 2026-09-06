/* Shared public report model: local only, no cloud calls or account data. */
(function(root){
  const words=(lang,pt,en,es)=>lang==='pt'?pt:lang==='es'?es:en;
  function duration(ms){const s=Math.floor(Math.max(0,Number(ms)||0)/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
  function fields(m,lang='en'){
    const w=(pt,en,es)=>words(lang,pt,en,es),out=[];
    const add=(k,v)=>{if(v!==undefined&&v!==null&&String(v).trim())out.push([k,String(v).trim()]);};
    add(w('Data','Date','Fecha'),[m.date,m.time].filter(Boolean).join(' '));
    if(m.source==='watch'){
      add(w('Registro','Recorded','Registro'),w('Relógio Wear OS','Wear OS watch','Reloj Wear OS'));
      add(w('Tempo ativo','Active time','Tiempo activo'),duration(m.durationMillis));
      if(Number.isFinite(m.estimatedCalories)&&m.estimatedCalories>=0) {
        const source=m.calorieSource==='health_services'?w('relógio','watch','reloj'):w('peso/tempo','weight/time','peso/tiempo');
        const partial=['partial','interrupted','unavailable','permission'].includes(m.calorieStatus)?w(' · parcial',' · partial',' · parcial'):'';
        add(w('Calorias estimadas','Estimated calories','Calorías estimadas'),'≈ '+m.estimatedCalories+' kcal · '+source+partial);
      }
      if(Number.isFinite(m.steps)&&m.steps>=0)add(w('Passos','Steps','Pasos'),m.steps);
      if(m.bluePointsLabel&&m.redPointsLabel)add(w('Último game · pontos','Last game · points','Último game · puntos'),m.bluePointsLabel+'–'+m.redPointsLabel);
    }
    const type={liga:w('Liga','League','Liga'),campeonato:w('Torneio','Tournament','Torneo'),torneio:w('Torneio','Tournament','Torneo')};
    add(w('Modalidade','Match type','Tipo de partido'),type[m.matchType]||w('Amistoso','Friendly','Amistoso'));
    const surface={saibro:w('Saibro','Clay','Tierra batida'),rapida:w('Rápida','Hard','Dura'),'rápida':w('Rápida','Hard','Dura'),grama:w('Grama','Grass','Césped')};
    add(w('Quadra','Surface','Superficie'),surface[String(m.surface||'').toLowerCase()]||m.surface);
    add(w('Local','Location','Lugar'),m.location);
    add(w('Parceiro','Partner','Compañero'),m.partner);
    add(w('Adversário 2','Opponent 2','Rival 2'),m.opponentTwo);
    add(w('Observações','Notes','Notas'),m.notes);
    return out;
  }
  function wrap(ctx,text,width){
    const lines=[];
    for(const paragraph of String(text).split('\n')){
      let line='';
      for(const ch of paragraph){
        if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line='';}
        line+=ch;
      }
      lines.push(line);
    }
    return lines;
  }
  async function draw(m,{lang='en',playerName='Player 1',opponentName,logoUrl='icons/share-logo.png'}={}){
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const font=(size,bold=false)=>{ctx.font=(bold?'700 ':'400 ')+size+'px Inter, sans-serif';};
    const one=m.playerName||playerName,two=opponentName||m.opponent||'Player 2';
    const sets=(Array.isArray(m.sets)?m.sets:[]).filter(s=>s&&(s.a!==''||s.b!==''));
    font(40,true);const names=[wrap(ctx,one,688),wrap(ctx,two,688)];
    font(26);const details=fields(m,lang).flatMap(([k,v])=>wrap(ctx,k+': '+v,688));
    const height=510+names.flat().length*49+Math.ceil(sets.length/6)*98+details.length*37;
    if(height>16000)throw new Error('Report exceeds image size limit');
    canvas.width=800;canvas.height=height;
    const W=800,H=canvas.height;
    ctx.fillStyle='#061722';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#DBF71C';ctx.fillRect(0,0,W,9);
    const logo=await new Promise(resolve=>{
      const img=new Image();const timer=setTimeout(()=>resolve(null),3000);
      img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);resolve(null);};img.src=logoUrl;
    });
    if(logo)ctx.drawImage(logo,46,37,96,96);
    ctx.fillStyle='#F3F6F2';font(38,true);ctx.fillText('DEUCE SCORE',160,94);
    ctx.fillStyle='#DBF71C';font(18);ctx.fillText(words(lang,'RELATÓRIO DA PARTIDA','MATCH REPORT','INFORME DEL PARTIDO'),56,177);
    const outcome=m.result==='V'?words(lang,'VITÓRIA','WIN','VICTORIA'):m.result==='D'?words(lang,'DERROTA','LOSS','DERROTA'):words(lang,'SEM VENCEDOR','NO WINNER','SIN GANADOR');
    ctx.fillStyle='#DBF71C';ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(56,202,688,58,20);else ctx.rect(56,202,688,58);ctx.fill();
    ctx.fillStyle='#061722';font(25,true);ctx.fillText(outcome,78,240);
    let y=322;
    names.forEach((lines,i)=>{ctx.fillStyle=i===0?'#3DA6E3':'#F66B78';font(40,true);lines.forEach(l=>{ctx.fillText(l,56,y);y+=49;});y+=15;});
    y+=18;
    sets.forEach((s,i)=>{
      const x=56+(i%6)*116,sy=y+Math.floor(i/6)*98;
      ctx.fillStyle='#10293A';ctx.fillRect(x,sy,104,84);
      ctx.fillStyle='#8FADBE';font(16);ctx.fillText('SET '+(i+1),x+12,sy+25);
      ctx.fillStyle='#F3F6F2';font(25,true);ctx.fillText(s.a+'–'+s.b,x+12,sy+61,88);
    });
    y+=Math.ceil(sets.length/6)*98+30;
    ctx.fillStyle='#8FADBE';font(26);details.forEach(l=>{ctx.fillText(l,56,y);y+=37;});
    ctx.fillStyle='#DBF71C';font(19,true);ctx.fillText('PLAY. TRACK. IMPROVE.',56,H-44);
    return canvas;
  }
  root.DeuceMatchReport={fields,draw,duration};
})(typeof window==='undefined'?globalThis:window);
