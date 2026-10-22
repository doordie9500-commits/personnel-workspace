// Horizontal table navigation independent of moving scheduled records.
export function scheduleScroll(el,table){
 const viewport=el('div',{class:'table-wrap schedule-viewport',tabindex:0,'aria-label':'Графік: прокручування мишею або клавішами'},table);
 const slider=el('input',{type:'range',min:0,max:0,step:1,value:0,'aria-label':'Прокрутити графік по горизонталі'});
 const spacer=el('div'),rail=el('div',{class:'schedule-scrollbar',tabindex:0,'aria-label':'Нижня смуга прокручування графіка'},spacer,slider);
 const shell=el('div',{class:'schedule-scroll-shell'},viewport,rail);
 const monthLabels=()=>{const bounds=viewport.getBoundingClientRect(),frozen=table.querySelector('thead th[rowspan]')?.getBoundingClientRect().width||0;for(const cell of table.querySelectorAll('[data-calendar-month]')){const label=cell.querySelector('.calendar-month-label');if(!label)continue;const box=cell.getBoundingClientRect(),offset=Math.max(0,Math.min(bounds.left+frozen+12-box.left-12,box.width-label.getBoundingClientRect().width-24));label.style.transform='translateX('+offset+'px)';}};
 const resize=()=>{spacer.style.width=table.scrollWidth+'px';slider.max=String(Math.max(0,table.scrollWidth-viewport.clientWidth));slider.value=String(viewport.scrollLeft);slider.style.setProperty('--scroll-thumb-size',Math.max(32,viewport.clientWidth/table.scrollWidth*viewport.clientWidth)+'px');rail.scrollLeft=viewport.scrollLeft;monthLabels();};
 slider.addEventListener('input',()=>{viewport.scrollLeft=Number(slider.value);rail.scrollLeft=viewport.scrollLeft;});
 viewport.addEventListener('scroll',()=>{monthLabels();slider.value=String(viewport.scrollLeft);if(Math.abs(rail.scrollLeft-viewport.scrollLeft)>1)rail.scrollLeft=viewport.scrollLeft;});
 rail.addEventListener('scroll',()=>{slider.value=String(rail.scrollLeft);if(Math.abs(viewport.scrollLeft-rail.scrollLeft)>1)viewport.scrollLeft=rail.scrollLeft;});
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
