export default {
	getLevelingHTML() {
		const rawData = (getLevelingNodes.data || []).map(function(n) {
			return Object.assign({}, n, { type_label: LevelingJS.getNodeTypeLabel(n.node_type) });
		});
		const dataStr = JSON.stringify(rawData);

		const js = [
			'var allData=' + dataStr + ';',
			'var NODE_W=150,GROUP_W=215,NODE_H=90,H_GAP=18,V_GAP=44;',
			'var typeBg={"fg":"#E6F1FB","spine":"#E6F1FB","cos_central":"#FBEAF0","cutting_group":"#EAF3DE","cutting_per_part":"#EAF3DE","wip":"#EEEDFE","stockfitting":"#EEEDFE","part":"#F1EFE8"};',
			'var typeBorder={"fg":"#B5D4F4","spine":"#B5D4F4","cos_central":"#F4C0D1","cutting_group":"#C0DD97","cutting_per_part":"#C0DD97","wip":"#CECBF6","stockfitting":"#CECBF6","part":"#D3D1C7"};',
			'var typeText={"fg":"#0C447C","spine":"#0C447C","cos_central":"#72243E","cutting_group":"#27500A","cutting_per_part":"#27500A","wip":"#3C3489","stockfitting":"#3C3489","part":"#444441"};',
			'var GROUPED_TYPES=["part","cutting_per_part"];',
			'var collapsed=new Set(),scale=1,panX=20,panY=20,isDragging=false,startX=0,startY=0,startPanX=0,startPanY=0;',
			'function trunc(s,n){if(!s||s==="-"||s==="")return "-";return String(s).length>n?String(s).slice(0,n-1)+"...":String(s);}',
			'function buildTree(data){',
			'  var byCode={},groupMap={},nodes=[],grpRows=[],leafRows=[];',
			'  data.forEach(function(d){',
			'    var nt=d.node_type;',
			'    if(nt==="part"){leafRows.push(d);return;}',
			'    if(GROUPED_TYPES.indexOf(nt)>=0){grpRows.push(d);return;}',
			'    var node=Object.assign({},d,{_key:"node_"+d.id,is_group:false,parts:null,children:[]});',
			'    nodes.push(node);',
			'    byCode[d.node_code]=node;',
			'  });',
			'  function addToGroup(d){',
			'    var par=d.parent_code||null;',
			'    var parentNode=par?byCode[par]:null;',
			'    var gk=d.node_type+"|"+(parentNode?parentNode._key:(par||"root"));',
			'    if(!groupMap[gk]){',
			'      var gn={node_code:null,node_type:d.node_type,type_label:d.type_label,parent_code:par,is_manual:false,_key:"grp_"+gk,is_group:true,parts:[],children:[]};',
			'      groupMap[gk]=gn;nodes.push(gn);',
			'    }',
			'    byCode[d.node_code]=groupMap[gk];',
			'    groupMap[gk].parts.push({id:d.id,node_code:d.node_code,node_name:d.node_name,part_id:d.part_id,is_manual:d.is_manual,lead_time_days:d.lead_time_days,node_type:d.node_type});',
			'    if(d.is_manual)groupMap[gk].is_manual=true;',
			'  }',
			'  grpRows.forEach(addToGroup);',
			'  leafRows.forEach(addToGroup);',
			'  var roots=[];',
			'  nodes.forEach(function(node){',
			'    if(!node.parent_code){roots.push(node);return;}',
			'    var parent=byCode[node.parent_code];',
			'    if(parent&&parent._key!==node._key)parent.children.push(node);',
			'    else roots.push(node);',
			'  });',
			'  return roots;',
			'}',
			'function nodeWidth(node){return node.is_group?GROUP_W:NODE_W;}',
			'function subtreeWidth(node){',
			'  var nw=nodeWidth(node);',
			'  if(collapsed.has(node._key)||!node.children||node.children.length===0)return nw;',
			'  var w=node.children.map(subtreeWidth);',
			'  return Math.max(nw,w.reduce(function(a,b){return a+b+H_GAP;},0)-H_GAP);',
			'}',
			'function nodeHeight(node){',
			'  if(!node.is_group||!node.parts||node.parts.length===0)return NODE_H;',
			'  var h=38;',
			'  node.parts.forEach(function(pt){h+=(pt.part_id?42:31);});',
			'  return Math.max(NODE_H,h+6);',
			'}',
			'function assignPos(node,x,y,positions){',
			'  var sw=subtreeWidth(node);',
			'  var nw=nodeWidth(node);',
			'  positions[node._key]={x:x+(sw-nw)/2,y:y};',
			'  if(!collapsed.has(node._key)&&node.children&&node.children.length>0){',
			'    var cx=x;',
			'    node.children.forEach(function(child){var csw=subtreeWidth(child);assignPos(child,cx,y+nodeHeight(node)+V_GAP,positions);cx+=csw+H_GAP;});',
			'  }',
			'}',
			'function collectAll(node,list){list.push(node);if(!collapsed.has(node._key))node.children.forEach(function(c){collectAll(c,list);});}',
			'function mkRect(x,y,w,h,fill,stroke){return ["<rect x=",x," y=",y," width=",w," height=",h," rx=\\"8\\" fill=\\"",fill,"\\" stroke=\\"",stroke,"\\" stroke-width=\\"0.8\\"/>"].join("");}',
			'function mkText(x,y,size,weight,fill,txt){return ["<text x=",x," y=",y," font-size=\\"",size,"\\" font-weight=\\"",weight,"\\" fill=\\"",fill,"\\">",txt,"</text>"].join("");}',
			'function render(){',
			'  var roots=buildTree(allData);',
			'  if(roots.length===0){document.getElementById("bagan").innerHTML="<text x=\'20\' y=\'40\' font-size=\'13\' fill=\'#888\'>Belum ada data. Klik Generate dulu.</text>";return;}',
			'  var positions={},startCx=0;',
			'  roots.forEach(function(r){var sw=subtreeWidth(r);assignPos(r,startCx,0,positions);startCx+=sw+H_GAP*2;});',
			'  var allNodes=[];roots.forEach(function(r){collectAll(r,allNodes);});',
			'  var minX=Infinity,maxX=-Infinity,maxY=-Infinity;',
			'  allNodes.forEach(function(n){var p=positions[n._key];if(!p)return;var nw=nodeWidth(n);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x+nw);maxY=Math.max(maxY,p.y+nodeHeight(n));});',
			'  var PAD=24,svgW=maxX-minX+PAD*2,svgH=maxY+PAD*2,offX=-minX+PAD,offY=PAD;',
			'  var svg=document.getElementById("bagan");',
			'  svg.setAttribute("width",svgW);svg.setAttribute("height",svgH);',
			'  var edges=[],nodesHtml=[];',
			'  allNodes.forEach(function(node){',
			'    var p=positions[node._key];if(!p)return;',
			'    if(node.parent_code){',
			'      var par=allNodes.find(function(n){return (!n.is_group&&n.node_code===node.parent_code)||(n.is_group&&n.parts&&n.parts.some(function(pt){return pt.node_code===node.parent_code;}));});',
			'      if(par&&positions[par._key]){',
			'        var pp=positions[par._key],px=pp.x+offX+nodeWidth(par)/2,py=pp.y+offY+nodeHeight(par),cx2=p.x+offX+nodeWidth(node)/2,cy2=p.y+offY,mY=(py+cy2)/2;',
			'        edges.push("<path fill=\'none\' stroke=\'#ccc\' stroke-width=\'0.8\' d=\'M"+px+","+py+" C"+px+","+mY+" "+cx2+","+mY+" "+cx2+","+cy2+"\'/>");',
			'      }',
			'    }',
			'  });',
			'  allNodes.forEach(function(node){',
			'    var p=positions[node._key];if(!p)return;',
			'    var x=p.x+offX,y=p.y+offY;',
			'    var nw=nodeWidth(node),nh=nodeHeight(node);',
			'    var bg=typeBg[node.node_type]||"#F1EFE8";',
			'    var bd=typeBorder[node.node_type]||"#D3D1C7";',
			'    var tc=typeText[node.node_type]||"#444441";',
			'    var hasKids=node.children&&node.children.length>0;',
			'    var isCol=collapsed.has(node._key);',
			'    var parts=[];',
			'    parts.push(mkRect(x,y,nw,nh,bg,bd));',
			'    if(node.is_manual)parts.push("<circle cx=\'"+(x+10)+"\' cy=\'"+(y+10)+"\' r=\'4\' fill=\'#D4537E\'/>");',
			'    if(hasKids)parts.push("<rect x=\'"+(x+nw-20)+"\' y=\'"+(y+5)+"\' width=\'15\' height=\'15\' rx=\'3\' fill=\'"+bd+"\' class=\'toggle-btn\' data-key=\'"+node._key+"\' style=\'cursor:pointer\'/>","<text x=\'"+(x+nw-12)+"\' y=\'"+(y+16)+"\' text-anchor=\'middle\' font-size=\'12\' fill=\'"+tc+"\' pointer-events=\'none\'>"+(isCol?"+":"-")+"</text>");',
			'    parts.push(mkText(x+8,y+16,11,500,tc,trunc(node.node_code,22)));',
			'    parts.push(mkText(x+8,y+30,10,400,"#888",trunc(node.type_label,26)));',
			'    if(node.is_group&&node.parts&&node.parts.length>0){',
			'      parts.push("<line x1=\'"+(x+4)+"\' y1=\'"+(y+36)+"\' x2=\'"+(x+nw-4)+"\' y2=\'"+(y+36)+"\' stroke=\'"+bd+"\' stroke-width=\'0.8\'/>");',
			'      var py2=y+50;',
			'      node.parts.forEach(function(pt){',
			'        if(pt.is_manual)parts.push("<circle cx=\'"+(x+9)+"\' cy=\'"+(py2-4)+"\' r=\'3\' fill=\'#D4537E\'/>");',
			'        var label=trunc(pt.node_code,13)+" \u00b7 "+trunc(pt.node_name,16);',
			'        parts.push(mkText(x+14,py2,10,400,"#333",label));',
			'        var ptLtDisp=pt.lead_time_days!=null?String(pt.lead_time_days)+" hari":"- hari";',
			'        if(pt.part_id){',
			'          parts.push(mkText(x+14,py2+12,9,400,"#aaa","ID: "+pt.part_id));',
			'          parts.push("<text data-id=\\""+pt.id+"\\" data-lt=\\"" + (pt.lead_time_days!=null?pt.lead_time_days:"") + "\\" x=\\"" + (x+14) + "\\" y=\\"" + (py2+26) + "\\" font-size=\\"9\\" fill=\\"#4A90D9\\" style=\\"cursor:pointer\\">\u25b6 LT: " + ptLtDisp + "<\\/text>");',
			'          py2+=42;',
			'        } else {',
			'          parts.push("<text data-id=\\""+pt.id+"\\" data-lt=\\"" + (pt.lead_time_days!=null?pt.lead_time_days:"") + "\\" x=\\"" + (x+14) + "\\" y=\\"" + (py2+14) + "\\" font-size=\\"9\\" fill=\\"#4A90D9\\" style=\\"cursor:pointer\\">\u25b6 LT: " + ptLtDisp + "<\\/text>");',
			'          py2+=31;',
			'        }',
			'      });',
			'    } else {',
			'      parts.push(mkText(x+8,y+46,10,400,"#333",trunc(node.node_name,20)));',
			'      if(node.supplier_name)parts.push(mkText(x+8,y+60,9,400,"#aaa",trunc("Supplier: "+node.supplier_name,26)));',
			'      var ltDisplay=node.lead_time_days!=null?String(node.lead_time_days)+" hari":"- hari";',
			'      parts.push("<text data-id=\\""+node.id+"\\" data-lt=\\"" + (node.lead_time_days!=null?node.lead_time_days:"") + "\\" x=\\"" + (x+8) + "\\" y=\\"" + (y+76) + "\\" font-size=\\"10\\" fill=\\"#4A90D9\\" style=\\"cursor:pointer\\">\u25b6 LT: " + ltDisplay + "<\\/text>");',
			'    }',
			'    if(isCol&&hasKids)parts.push("<text x=\'"+(x+nw/2)+"\' y=\'"+(y+nh-5)+"\' text-anchor=\'middle\' font-size=\'9\' fill=\'"+tc+"\'>["+node.children.length+" hidden]</text>");',
			'    nodesHtml.push("<g class=\'node-g\' data-key=\'"+node._key+"\'>");',
			'    nodesHtml.push(parts.join(""));',
			'    nodesHtml.push("</g>");',
			'  });',
			'  svg.innerHTML=edges.join("")+nodesHtml.join("");',
			'  svg.querySelectorAll(".toggle-btn").forEach(function(el){',
			'    el.addEventListener("click",function(e){e.stopPropagation();var k=el.dataset.key;if(collapsed.has(k))collapsed.delete(k);else collapsed.add(k);render();});',
			'  });',
			'  svg.querySelectorAll("text[data-id]").forEach(function(el){',
			'    el.addEventListener("click",function(e){e.stopPropagation();editLT(el.getAttribute("data-id"),el.getAttribute("data-lt"));});',
			'  });',
			'}',
			'function updateTransform(){document.getElementById("canvas").style.transform="translate("+panX+"px,"+panY+"px) scale("+scale+")";document.getElementById("zoom-info").textContent=Math.round(scale*100)+"%";}',
			'function zoomBy(d){scale=Math.min(3,Math.max(0.2,scale+d));updateTransform();}',
			'function resetView(){scale=1;panX=20;panY=20;updateTransform();}',
			'function expandAll(){collapsed.clear();render();}',
			'function collapseAll(){var roots=buildTree(allData);function addAll(n){if(n.children&&n.children.length>0){collapsed.add(n._key);n.children.forEach(addAll);}}roots.forEach(addAll);render();}',
			'var wrap=document.getElementById("canvas-wrap");',
			'wrap.addEventListener("mousedown",function(e){if(e.target.classList.contains("toggle-btn")||e.target.hasAttribute("data-id"))return;isDragging=true;startX=e.clientX;startY=e.clientY;startPanX=panX;startPanY=panY;});',
			'window.addEventListener("mousemove",function(e){if(!isDragging)return;panX=startPanX+(e.clientX-startX);panY=startPanY+(e.clientY-startY);updateTransform();});',
			'window.addEventListener("mouseup",function(){isDragging=false;});',
			'wrap.addEventListener("wheel",function(e){e.preventDefault();zoomBy(e.deltaY<0?0.1:-0.1);},{passive:false});',
			'function editLT(nodeId,curLt){',
			'  var val=prompt("Lead Time (hari):",curLt!==""&&curLt!=="null"?curLt:"");',
			'  if(val===null)return;',
			'  var t=val.trim();',
			'  var n=t===""?null:parseInt(t);',
			'  if(t!==""&&isNaN(n)){alert("Masukkan angka!");return;}',
			'  for(var i=0;i<allData.length;i++){',
			'    if(String(allData[i].id)===String(nodeId)){allData[i].lead_time_days=n;break;}',
			'  }',
			'  render();',
			'  window.parent.postMessage(JSON.stringify({type:"UPDATE_LEAD_TIME",id:parseInt(nodeId),lead_time_days:n}),"*");',
			'}',
			'updateTransform();render();'
		].join('\n');

		const css = [
			'* { box-sizing: border-box; margin: 0; padding: 0; }',
			'body { font-family: sans-serif; background: #fafafa; }',
			'#toolbar { display: flex; align-items: center; gap: 10px; padding: 10px; background: white; border-bottom: 1px solid #eee; flex-wrap: wrap; }',
			'button { height: 30px; padding: 0 10px; font-size: 12px; border: 1px solid #ccc; border-radius: 5px; background: white; cursor: pointer; }',
			'#zoom-info { font-size: 12px; color: #888; }',
			'#canvas-wrap { width: 100%; height: calc(100vh - 52px); overflow: hidden; position: relative; cursor: grab; }',
			'#canvas-wrap:active { cursor: grabbing; }',
			'#canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }'
		].join('\n');

		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="toolbar">
<button onclick="zoomBy(0.15)">+</button>
<button onclick="zoomBy(-0.15)">-</button>
<button onclick="resetView()">Reset</button>
<span id="zoom-info">100%</span>
<button onclick="expandAll()">Expand All</button>
<button onclick="collapseAll()">Collapse All</button>
</div>
<div id="canvas-wrap"><div id="canvas"><svg id="bagan"></svg></div></div>
<script>${js}<\/script>
</body></html>`;
	},

	async onLeadTimeOverride(rawMsg) {
		let msg;
		try {
			msg = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
		} catch (e) {
			return;
		}
		if (!msg || msg.type !== 'UPDATE_LEAD_TIME') return;

		const u = appsmith.store.currentUser;
		if (!u || !['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'].includes(u.role)) {
			showAlert('Anda tidak punya akses untuk mengubah lead time.', 'error');
			return;
		}
		try {
			await updateLevelingLeadTime.run({ id: msg.id, lt: msg.lead_time_days });
			await getLevelingNodes.run();
		} catch (e) {
			showAlert('Gagal update lead time: ' + e.message, 'error');
		}
	}
}