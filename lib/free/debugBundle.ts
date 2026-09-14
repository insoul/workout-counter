import { EXERCISES } from '@/lib/detectors/registry';
import { POSE_EDGES } from '@/lib/pose/landmarks';
import { buildZip, type ZipEntry } from '@/lib/zip';
import type { Segment } from './log';

/**
 * 디버그 묶음: 한 폴더에 사진(JPEG)·세션 데이터(JSON)·뷰어(index.html)를 넣은 ZIP.
 * AirDrop 으로 맥에 보내 압축을 풀고 index.html 을 열면 사진 위에 관절과 게이트 값이 보인다.
 * 뷰어는 세션 데이터를 인라인으로 품고 사진만 상대 경로로 읽는다 — file:// 에서 fetch 는
 * 막히지만 <img> 는 열리기 때문이다.
 */

export interface DebugBundleInput {
  startedAt: number;
  endedAt: number;
  segments: Segment[];
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function viewerHtml(data: unknown): string {
  // </script> 가 JSON 문자열에 들어 있어도 스크립트가 끊기지 않게
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>운동 디버그</title>
<style>
body{margin:0;padding:24px;background:#0a0a0a;color:#e5e5e5;font:14px/1.5 -apple-system,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}.meta{color:#a3a3a3;margin-bottom:20px}
.entry{display:grid;grid-template-columns:320px 1fr;gap:16px;margin-bottom:24px;padding:16px;background:#171717;border-radius:12px}
.shot{position:relative;width:320px;background:#000;border-radius:8px;overflow:hidden}
.shot img{display:block;width:320px}.shot svg{position:absolute;inset:0;width:100%;height:100%}
.title{font-size:18px;font-weight:700}.val{color:#4ade80;font-weight:700}
.det{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#86efac;display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px}
.at{color:#737373;font-size:12px}.nolm{color:#f87171}
@media (max-width:720px){.entry{grid-template-columns:1fr}}
</style></head><body>
<h1>운동 디버그</h1><div class="meta" id="meta"></div><div id="entries"></div>
<script type="application/json" id="data">${json}</script>
<script>
const EDGES=${JSON.stringify(POSE_EDGES)};
const NAMES=${JSON.stringify(Object.fromEntries(Object.values(EXERCISES).map((m) => [m.id, m.nameKo])))};
const KINDS=${JSON.stringify(Object.fromEntries(Object.values(EXERCISES).map((m) => [m.id, m.kind])))};
const d=JSON.parse(document.getElementById('data').textContent);
const fmt=(k,v)=>k==='rep'?v+'회':Math.floor(v/1000)+'초';
document.getElementById('meta').textContent=new Date(d.startedAt).toLocaleString('ko-KR')+' · '+Math.round((d.endedAt-d.startedAt)/60000)+'분 · 구간 '+d.segments.length+'개';
const root=document.getElementById('entries');
d.segments.forEach((s,i)=>{
  const el=document.createElement('div');el.className='entry';
  const shot=document.createElement('div');shot.className='shot';
  const img=document.createElement('img');
  const dbg=s.debug||{};
  const draw=()=>{
    if(!dbg.lm){shot.insertAdjacentHTML('beforeend','<div class="nolm" style="padding:12px">랜드마크 없음</div>');return}
    const w=320,h=Math.round(320*(img.naturalHeight||3)/(img.naturalWidth||4));shot.style.height=h+'px';
    const P=i=>({x:dbg.lm[i*3]*w,y:dbg.lm[i*3+1]*h,v:dbg.lm[i*3+2]});
    let svg='<svg viewBox="0 0 '+w+' '+h+'">';
    for(const [a,b] of EDGES){const A=P(a),B=P(b);if(A.v<.5||B.v<.5)continue;
      svg+='<line x1="'+A.x+'" y1="'+A.y+'" x2="'+B.x+'" y2="'+B.y+'" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>'}
    for(let k=11;k<33;k++){const p=P(k);svg+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3" fill="'+(p.v<.5?'#f87171':'#4ade80')+'" opacity="'+(p.v<.5?.6:1)+'"><title>'+k+' vis '+p.v+'</title></circle>'}
    shot.insertAdjacentHTML('beforeend',svg+'</svg>');
  };
  if(dbg.photo){img.src=dbg.photo;img.onload=draw;img.onerror=()=>{img.remove();draw()};shot.appendChild(img)}else{img.remove();shot.style.height='240px';draw()}
  const info=document.createElement('div');
  info.innerHTML='<div class="title">'+(i+1)+'. '+(NAMES[s.exerciseId]||s.exerciseId)+' <span class="val">'+fmt(KINDS[s.exerciseId]||s.kind,s.value)+'</span></div>'
    +'<div class="at">시작 후 '+(dbg.at!=null?Math.round(dbg.at/1000)+'초':'?')+' 시점 — 구간이 처음 기록된 순간</div>'
    +'<div class="det">'+Object.entries(dbg.det||{}).map(([k,v])=>k+'='+v).join('</span><span>').replace(/^/,'<span>').replace(/$/,'</span>')+'</div>';
  el.append(shot,info);root.appendChild(el);
});
</script></body></html>`;
}

/** ZIP 파일을 만든다. 폴더 이름은 workout-debug-YYYYMMDD-HHMM */
export function buildDebugBundle(input: DebugBundleInput): File {
  const folder = `workout-debug-${stamp(input.startedAt)}`;
  const entries: ZipEntry[] = [];
  const segments = input.segments.map((s, i) => {
    const photoName = s.debug?.photo ? `entry-${String(i).padStart(2, '0')}.jpg` : undefined;
    if (photoName && s.debug?.photo) {
      entries.push({ name: `${folder}/${photoName}`, data: dataUrlToBytes(s.debug.photo) });
    }
    return {
      exerciseId: s.exerciseId,
      kind: s.kind,
      value: s.value,
      debug: s.debug ? { at: s.debug.at, det: s.debug.det, lm: s.debug.lm, photo: photoName } : undefined,
    };
  });
  const data = { startedAt: input.startedAt, endedAt: input.endedAt, segments };
  const enc = new TextEncoder();
  entries.push({ name: `${folder}/session.json`, data: enc.encode(JSON.stringify(data, null, 2)) });
  entries.push({ name: `${folder}/index.html`, data: enc.encode(viewerHtml(data)) });
  const bytes = buildZip(entries, new Date(input.endedAt));
  return new File([bytes as BlobPart], `${folder}.zip`, { type: 'application/zip' });
}

/** iOS 공유 시트(AirDrop 포함)로 보낸다. 공유를 지원하지 않으면 false */
export async function shareDebugBundle(file: File): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch {
    // 사용자가 공유 시트를 닫은 경우 포함
    return false;
  }
}
