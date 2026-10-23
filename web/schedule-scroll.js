// Horizontal table navigation independent of moving scheduled records.
const calendarPositions=new Map();
export function scheduleScroll(el,table){
 const memoryKey=table.className+'|'+(table.querySelector('[data-calendar-month]')?.dataset.calendarMonth||''),remembered=calendarPositions.get(memoryKey)||0;let initialized=false;
 const viewport=el('div',{class:'table-wrap schedule-viewport',tabindex:0,'aria-label':'Графік: прокручування мишею або клавішами'},table);
 const slider=el('input',{type:'range',min:0,max:0,step:1,value:0,'aria-label':'Прокрутити графік по горизонталі'});
 const rail=el('div',{class:'schedule-scrollbar','aria-label':'Нижня смуга прокручування графіка'},slider);
 const shell=el('div',{class:'schedule-scroll-shell'},viewport,rail);
 const monthLabels=()=>{const bounds=viewport.getBoundingClientRect(),frozen=table.querySelector('thead th[rowspan]')?.getBoundingClientRect().width||0;for(const cell of table.querySelectorAll('[data-calendar-month]')){const label=cell.querySelector('.calendar-month-label');if(!label)continue;const box=cell.getBoundingClientRect(),offset=Math.max(0,Math.min(bounds.left+frozen+12-box.left-12,box.width-label.getBoundingClientRect().width-24));label.style.transform='translateX('+offset+'px)';}};
 const resize=()=>{const max=Math.max(0,table.scrollWidth-viewport.clientWidth);if(!initialized){initialized=true;viewport.scrollLeft=Math.min(remembered,max);}slider.max=String(max);slider.value=String(viewport.scrollLeft);slider.style.setProperty('--scroll-thumb-size',Math.max(32,viewport.clientWidth/table.scrollWidth*viewport.clientWidth)+'px');monthLabels();};
 slider.addEventListener('input',()=>{viewport.scrollLeft=Number(slider.value);});
 viewport.addEventListener('scroll',()=>{if(initialized&&viewport.isConnected)calendarPositions.set(memoryKey,viewport.scrollLeft);monthLabels();slider.value=String(viewport.scrollLeft);});
 let edge=0,frame=0;
 const stopEdge=()=>{edge=0;cancelAnimationFrame(frame);frame=0;};
 const scrollEdge=()=>{if(!edge||!shell.isConnected){stopEdge();return;}viewport.scrollLeft+=edge*14;frame=requestAnimationFrame(scrollEdge);};
 viewport.addEventListener('dragover',e=>{if(!Array.from(e.dataTransfer.types).includes('application/x-personnel-period'))return;const bounds=viewport.getBoundingClientRect();edge=e.clientX>bounds.right-55?1:e.clientX<bounds.left+55?-1:0;if(edge){e.preventDefault();if(!frame)frame=requestAnimationFrame(scrollEdge);}else stopEdge();});
 viewport.addEventListener('dragleave',e=>{const bounds=viewport.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)stopEdge();});
 viewport.addEventListener('drop',stopEdge);viewport.addEventListener('dragend',stopEdge);
 let start=null,panned=false;
 viewport.addEventListener('pointerdown',e=>{panned=false;start=null;
  if(e.pointerType!=='mouse'||![0,1].includes(e.button))return;
  if(e.button===0&&(e.target.closest('[draggable=true]')||e.target.closest('a,input,select,textarea,.person,.actions')))return;
  start={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,id:e.pointerId};panned=false;if(e.button===1)e.preventDefault();
 });
 viewport.addEventListener('pointermove',e=>{if(!start)return;if(!e.buttons){start=null;return;}const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!panned&&Math.hypot(dx,dy)<6)return;if(!panned){panned=true;viewport.setPointerCapture(start.id);viewport.classList.add('is-panning');}e.preventDefault();viewport.scrollLeft=start.left-dx;viewport.scrollTop=start.top-dy;});
 const end=()=>{start=null;viewport.classList.remove('is-panning');};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
 viewport.addEventListener('click',e=>{if(panned){e.preventDefault();e.stopImmediatePropagation();panned=false;}},true);
 viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();viewport.scrollLeft+=e.key==='ArrowRight'?100:-100;}});
 if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(!shell.isConnected){observer.disconnect();return;}resize();});requestAnimationFrame(()=>{resize();observer.observe(viewport);observer.observe(table);});}else requestAnimationFrame(resize);
 return shell;
}
